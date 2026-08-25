import test from 'node:test';
import assert from 'node:assert/strict';

import {
    detectInstalledNickelMenuFeatureIds,
    detectInstalledParentFeatures,
    parsePreviousNickelMenuSelections,
    readPreviousNickelMenuConfiguration,
    readPreviousNickelMenuSelections,
} from '../../src/js/nickelmenu/probes.js';
import { nickelMenuManifestPath } from '../../src/js/nickelmenu/constants.js';

test('parsePreviousNickelMenuSelections returns unique valid feature ids', () => {
    const text = JSON.stringify({
        selected: ['simplify-tabs', 'hide-notices', 'simplify-tabs', '', null, 42],
    });

    assert.deepEqual(parsePreviousNickelMenuSelections(text), ['simplify-tabs', 'hide-notices']);
});

test('parsePreviousNickelMenuSelections ignores malformed and incompatible manifests', () => {
    assert.deepEqual(parsePreviousNickelMenuSelections('{'), []);
    assert.deepEqual(parsePreviousNickelMenuSelections(JSON.stringify({ selected: 'simplify-tabs' })), []);
    assert.deepEqual(parsePreviousNickelMenuSelections(null), []);
});

test('readPreviousNickelMenuSelections reads the connected-device manifest path', async () => {
    const reads = [];
    const state = {
        manualMode: false,
        device: {
            directoryHandle: {},
            async readFile(path) {
                reads.push(path);
                return JSON.stringify({ selected: ['additional-fonts'] });
            },
        },
    };

    assert.deepEqual(await readPreviousNickelMenuSelections(state), ['additional-fonts']);
    assert.deepEqual(reads, [nickelMenuManifestPath]);
});

test('readPreviousNickelMenuSelections is optional in manual mode and on read failure', async () => {
    const manualState = {
        manualMode: true,
        device: {
            directoryHandle: {},
            async readFile() {
                assert.fail('manual mode should not read a device');
            },
        },
    };
    assert.deepEqual(await readPreviousNickelMenuSelections(manualState), []);

    const unreadableState = {
        manualMode: false,
        device: {
            directoryHandle: {},
            async readFile() {
                throw new DOMException('blocked', 'NotAllowedError');
            },
        },
    };
    assert.deepEqual(await readPreviousNickelMenuSelections(unreadableState), []);
});

// The only parent feature today is KOReader (SimpleUI declares it), so the probe
// looks for KOReader's cleanup detect path, .adds/koreader.
function deviceWithPaths(present) {
    const checked = [];
    return {
        checked,
        state: {
            manualMode: false,
            device: {
                directoryHandle: {},
                async pathExists(path) {
                    checked.push(path);
                    return present.some((p) => p.join('/') === path.join('/'));
                },
            },
        },
    };
}

test('detectInstalledParentFeatures reports a parent app already on the device', async () => {
    const { state, checked } = deviceWithPaths([['.adds', 'koreader']]);
    assert.deepEqual(await detectInstalledParentFeatures(state), ['koreader']);
    assert.deepEqual(checked, [['.adds', 'koreader']], 'only parent features are probed');
});

test('detectInstalledParentFeatures reports nothing when the parent app is absent', async () => {
    const { state } = deviceWithPaths([]);
    assert.deepEqual(await detectInstalledParentFeatures(state), []);
});

test('detectInstalledParentFeatures is a hint, so manual mode and read failures yield nothing', async () => {
    const manualState = {
        manualMode: true,
        device: {
            directoryHandle: {},
            async pathExists() {
                assert.fail('manual mode should not read a device');
            },
        },
    };
    assert.deepEqual(await detectInstalledParentFeatures(manualState), []);

    const unreadableState = {
        manualMode: false,
        device: {
            directoryHandle: {},
            async pathExists() {
                throw new DOMException('blocked', 'NotAllowedError');
            },
        },
    };
    assert.deepEqual(await detectInstalledParentFeatures(unreadableState), []);

    assert.deepEqual(await detectInstalledParentFeatures({ manualMode: false, device: {} }), [], 'no connected device');
});

test('readPreviousNickelMenuConfiguration copies a referenced custom icon into memory', async () => {
    const icon = new Uint8Array([60, 115, 118, 103, 62]);
    const state = {
        manualMode: false,
        device: {
            directoryHandle: {},
            async readFile(path) {
                if (path.join('/') === nickelMenuManifestPath.join('/')) {
                    return JSON.stringify({ selected: ['custom-menu'], features: {}, meta: { writer: { version: '1.54' } } });
                }
                return ['experimental :menu_main_15505_label :Read', 'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.custom-icon.svg'].join('\n');
            },
            async readFileBytes(path) {
                assert.deepEqual(path, ['.adds', 'nm', '.custom-icon.svg']);
                return icon;
            },
        },
    };

    const configuration = await readPreviousNickelMenuConfiguration(state);
    assert.equal(configuration.menuCustomization.label, 'Read');
    assert.deepEqual(configuration.menuCustomization.icon, {
        type: 'upload',
        name: '.custom-icon.svg',
        mimeType: 'image/svg+xml',
        data: icon,
    });
});

test('detectInstalledNickelMenuFeatureIds scans live folders and individual NickelHome flags', async () => {
    const existing = new Set(['.adds/koreader', '.adds/nickel-home']);
    const state = {
        manualMode: false,
        device: {
            directoryHandle: {},
            deviceInfo: { firmware: '4.40.0' },
            async readFile(path) {
                if (path.join('/') === '.adds/nickel-home/config') {
                    return 'hide_home_row1col2_enabled:0\n';
                }
                return '';
            },
            async pathExists(path) {
                return existing.has(path.join('/'));
            },
        },
    };

    const ids = await detectInstalledNickelMenuFeatureIds(state, [], true);
    assert.ok(ids.includes('koreader'));
    assert.ok(ids.includes('hide-recommendations'));
    assert.ok(!ids.includes('hide-row2col2'));
    assert.ok(!ids.includes('hide-notices'));
});

test('detectInstalledNickelMenuFeatureIds trusts history only for markerless features in an active preset', async () => {
    const state = {
        manualMode: false,
        device: {
            directoryHandle: {},
            async readFile() {
                return '';
            },
            async pathExists() {
                return false;
            },
        },
    };

    assert.ok((await detectInstalledNickelMenuFeatureIds(state, ['simplify-tabs'], true)).includes('simplify-tabs'));
    assert.ok(!(await detectInstalledNickelMenuFeatureIds(state, ['simplify-tabs'], false)).includes('simplify-tabs'));
});
