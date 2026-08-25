import test from 'node:test';
import assert from 'node:assert/strict';

import { detectInstalledParentFeatures, parsePreviousNickelMenuSelections, readPreviousNickelMenuSelections } from '../../src/js/nickelmenu/probes.js';
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
