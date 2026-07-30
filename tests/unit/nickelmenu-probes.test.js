import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePreviousNickelMenuSelections, readPreviousNickelMenuSelections } from '../../src/js/nickelmenu/probes.js';
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
