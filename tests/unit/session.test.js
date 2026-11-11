import test from 'node:test';
import assert from 'node:assert/strict';

import { Session } from '../../src/js/shell/session.js';
import { createDefaultMenuCustomization } from '../../src/js/nickelmenu/customization.js';

test('a new Session starts with default wizard data', () => {
    const s = new Session();
    assert.equal(s.manualMode, false);
    assert.equal(s.selectedMode, null);
    assert.equal(s.selectedChannel, null);
    assert.equal(s.patchesLoaded, false);
    assert.equal(s.isRestore, false);
    assert.deepEqual(s.selectedFeatureIds, []);
    assert.deepEqual(s.previousNickelMenuFeatureIds, []);
    assert.equal(s.previousNickelMenuConfiguration, null);
    assert.deepEqual(s.installedNickelMenuFeatureIds, []);
    assert.deepEqual(s.nickelMenuCustomization, createDefaultMenuCustomization());
});

test('Session declares its services and nav callbacks (honest shape, null until wired)', () => {
    const s = new Session();
    const declared = [
        'device',
        'patchUI',
        'runner',
        'nmInstaller',
        'getSoftwareUrl',
        'softwareUrlsReady',
        'availablePatchesReady',
        'availablePatches',
        'blacklistReady',
        'showError',
        'goToModeSelection',
        'goBackToDeviceStep',
        'goToManualVersionStep',
    ];
    for (const key of declared) {
        assert.ok(key in s, `expected Session to declare ${key}`);
        assert.equal(s[key], null);
    }
});

test('reset() restores wizard data without clearing the wired services', () => {
    const s = new Session();
    s.device = { connected: true };
    s.manualMode = true;
    s.selectedMode = 'patches';
    s.selectedFeatureIds = ['a', 'b'];
    s.resultTgz = new Uint8Array([1]);

    s.reset();

    assert.equal(s.manualMode, false);
    assert.equal(s.selectedMode, null);
    assert.deepEqual(s.selectedFeatureIds, []);
    assert.equal(s.resultTgz, null);
    // reset() only clears wizard data; the service the app wired stays put.
    assert.deepEqual(s.device, { connected: true });
});

test('resetDeviceContext clears device-derived fields but keeps mode/feature choices', () => {
    const s = new Session();
    s.manualMode = true;
    s.selectedFeatureIds = ['x'];
    s.previousNickelMenuFeatureIds = ['previous'];
    s.previousNickelMenuConfiguration = { selectedFeatureIds: ['previous'] };
    s.installedNickelMenuFeatureIds = ['installed'];
    s.selectedChannel = 'kobo9';
    s.firmwareURL = 'https://dl/fw.zip';
    s.firmwareVersion = '4.45.23646';
    s.patchesLoaded = true;
    s.resultTgz = new Uint8Array([1]);

    s.resetDeviceContext();

    assert.equal(s.selectedChannel, null);
    assert.equal(s.firmwareURL, null);
    assert.equal(s.firmwareVersion, null);
    assert.equal(s.patchesLoaded, false);
    assert.equal(s.resultTgz, null);
    assert.deepEqual(s.previousNickelMenuFeatureIds, []);
    assert.equal(s.previousNickelMenuConfiguration, null);
    assert.deepEqual(s.installedNickelMenuFeatureIds, []);
    // Mode and feature selections survive a device-context reset.
    assert.equal(s.manualMode, true);
    assert.deepEqual(s.selectedFeatureIds, ['x']);
});
