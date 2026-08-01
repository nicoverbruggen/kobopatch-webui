import test from 'node:test';
import assert from 'node:assert/strict';

import { Session } from '../../src/js/shell/Session.js';

const SERVICES = {
    device: { name: 'device' },
    patchUI: { name: 'patchUI' },
    runner: { name: 'runner' },
    nmInstaller: { name: 'nmInstaller' },
    getSoftwareUrl: () => 'https://example/fw.zip',
    softwareUrlsReady: Promise.resolve(),
    blacklistReady: Promise.resolve(),
};

const newSession = () => new Session({ ...SERVICES });

test('a new Session starts with default wizard data', () => {
    const s = newSession();
    assert.equal(s.manualMode, false);
    assert.equal(s.selectedMode, null);
    assert.equal(s.selectedChannel, null);
    assert.equal(s.patchesLoaded, false);
    assert.equal(s.isRestore, false);
    assert.equal(s.firmwareURL, null);
    assert.equal(s.firmwareVersion, null);
    assert.equal(s.deviceModelLabel, null);
    assert.equal(s.patchesUnavailableReason, null);
    assert.equal(s.koboUserCount, undefined);
});

test('services arrive through the constructor, not by assignment afterwards', () => {
    const s = newSession();
    for (const key of ['device', 'patchUI', 'runner', 'nmInstaller', 'getSoftwareUrl', 'softwareUrlsReady', 'blacklistReady']) {
        assert.ok(key in s, `expected Session to declare ${key}`);
        assert.notEqual(s[key], null, `${key} should be wired at construction, not left null`);
    }
});

test('the navigation callbacks are gone — the wizard owns those edges now', () => {
    // They were assigned onto the session by four different modules after
    // construction, which is what made every call site nullable. Pinned so a
    // later change cannot quietly reintroduce one.
    const s = newSession();
    for (const key of ['showError', 'goToModeSelection', 'goBackToDeviceStep', 'goToManualVersionStep']) {
        assert.equal(key in s, false, `${key} should no longer live on Session`);
    }
});

test('startAvailablePatchesLoad writes the catalogue back onto the session', () => {
    const s = newSession();
    assert.equal(s.availablePatchesReady, null, 'not started until asked');

    const patches = [{ version: '4.45.23646', filename: 'p.zip' }];
    s.startAvailablePatchesLoad(() => Promise.resolve(patches));

    return s.availablePatchesReady.then(() => {
        assert.deepEqual(s.availablePatches, patches);
    });
});

test('Session carries only shared wizard state — per-flow data lives on the flows', () => {
    // The point of the Phase 3 split, pinned. Each of these moved into the flow
    // that owns it, and the header comment's claim that the shape is discoverable
    // from this file is only true while they stay off it.
    const s = newSession();
    const moved = [
        'nickelMenuOption', // -> NickelMenuSelection.option
        'selectedFeatureIds', // -> NickelMenuSelection
        'nmBackupChoice', // -> NickelMenuSelection.backupChoice
        'nmKeepLegacyConfig', // -> NickelMenuSelection.keepLegacyConfig
        'nmOptionalCleanupIds', // -> NickelMenuSelection.optionalCleanupIds
        'nickelMenuCustomization', // -> NickelMenuSelection.menuCustomization
        'nickelMenuTabsCustomization', // -> NickelMenuSelection.tabsCustomization
        'nickelMenuFontsCustomization', // -> NickelMenuSelection.fontsCustomization
        'previousNickelMenuFeatureIds', // -> DetectedInstallation.previousFeatureIds
        'previousNickelMenuConfiguration', // -> DetectedInstallation.previousConfiguration
        'installedNickelMenuFeatureIds', // -> DetectedInstallation.installedFeatureIds
        'resultNmZip', // -> NickelMenuOutcome.zip
        '_nmDoneMode', // -> NickelMenuOutcome.mode (was never declared at all)
        'resultTgz', // -> PatchesBuild.tgz
        'additionalFileEntries', // -> PatchesBuild (was never declared at all)
        'reloadManifest', // -> ReloadBanner.manifest
        'reloadAdditionalFiles', // -> ReloadBanner.additionalFiles
        'hasCustomPatchesManifest', // -> DeviceScreen (Phase 3 deferred it until a class existed)
    ];
    for (const key of moved) {
        assert.equal(key in s, false, `${key} should no longer live on Session`);
    }
});

test('resetDeviceContext clears device-derived fields but keeps the wizard mode', () => {
    const s = newSession();
    s.manualMode = true;
    s.selectedMode = 'patches';
    s.isRestore = true;
    s.selectedChannel = 'kobo9';
    s.firmwareURL = 'https://dl/fw.zip';
    s.firmwareVersion = '4.45.23646';
    s.deviceModelLabel = 'Kobo Clara';
    s.patchesUnavailableReason = 'because';
    s.patchesLoaded = true;
    s.koboUserCount = 2;

    s.resetDeviceContext();

    assert.equal(s.selectedChannel, null);
    assert.equal(s.firmwareURL, null);
    assert.equal(s.firmwareVersion, null);
    assert.equal(s.deviceModelLabel, null);
    assert.equal(s.patchesUnavailableReason, null);
    assert.equal(s.patchesLoaded, false);
    assert.equal(s.koboUserCount, undefined, '`undefined`, not null — it is what re-arms the probe');

    // What the user chose survives a device-context reset.
    assert.equal(s.manualMode, true);
    assert.equal(s.selectedMode, 'patches');
    assert.equal(s.isRestore, true);
});
