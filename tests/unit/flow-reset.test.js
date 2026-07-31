import './dom-harness.js'; // the flows look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { NickelMenuFlow } from '../../src/js/flows/nickelmenu/NickelMenuFlow.js';
import { PatchesFlow } from '../../src/js/flows/patches/PatchesFlow.js';
import { isDefaultMenuCustomization } from '../../src/js/nickelmenu/customization.js';

// Phase 3 moved the wizard's data off `Session` into per-flow objects, which
// makes the two resets — the flow restart and the device reconnect — testable for
// the first time. Both were previously long runs of `session.x = ...` that only
// the E2E mode-switch path touched, and then only incidentally.

const built = [];
test.afterEach(() => {
    while (built.length) built.pop().destroy();
});

function makeSession() {
    return {
        showError: () => {},
        manualMode: false,
        koboUserCount: 7,
        device: { deviceInfo: { firmware: '4.41.23145', uiLocale: 'en' }, directoryHandle: {} },
        patchUI: {
            onChange: null,
            getEnabledCount: () => 0,
            getAdditionalFileCount: () => 0,
            getAdditionalFiles: () => [],
            validateAdditionalFiles: () => ({ ok: true, message: '' }),
            render: () => {},
        },
    };
}

function makeNickelMenuFlow() {
    const flow = new NickelMenuFlow(makeSession());
    built.push(flow);
    return flow;
}

function makePatchesFlow() {
    const flow = new PatchesFlow(makeSession());
    built.push(flow);
    return flow;
}

// --- the flow restart -------------------------------------------------------

test('resetNickelMenuState re-clones the drafts from the reset customizations, not the old ones', () => {
    // The ordering the comment on `resetNickelMenuState` exists for: the drafts
    // are cloned from the selection, so `drafts.reset()` has to run *after*
    // `selection.resetCustomizations()`. Run it before and the drafts come back
    // holding the customization the user just discarded, and the next dialog they
    // open is seeded with it.
    const flow = makeNickelMenuFlow();
    flow.selection.menuCustomization = { label: 'Tools', icon: { type: 'default' } };
    flow.drafts.setMenu({ label: 'Tools', icon: { type: 'default' } });

    flow.resetNickelMenuState();

    assert.equal(isDefaultMenuCustomization(flow.selection.menuCustomization), true);
    assert.equal(isDefaultMenuCustomization(flow.drafts.menu), true, 'the draft must be re-cloned from the reset selection');
});

test('the summary chip shows the default customization after a reset and re-render', () => {
    // What the user actually sees. The chips live inside the feature list, which
    // `features.reset()` empties, so the three summary updaters inside
    // `resetNickelMenuState` have nothing to write into — the visible outcome only
    // appears on the next render, and it must reflect the defaults.
    const flow = makeNickelMenuFlow();
    flow.selection.menuCustomization = { label: 'Tools', icon: { type: 'default' } };
    flow.features.renderFeatureCheckboxes();

    const chipLabel = () => document.getElementById('nm-custom-menu-summary')?.querySelector('.nm-config-summary-label')?.textContent;
    assert.equal(chipLabel(), 'Tools', 'the chip shows the customization before the reset');

    flow.resetNickelMenuState();
    flow.features.renderFeatureCheckboxes();

    assert.equal(chipLabel(), 'Toggle', 'and the default afterwards');
});

test('resetNickelMenuState clears the probe results and the selection but keeps them separable', () => {
    const flow = makeNickelMenuFlow();
    flow.detected.webuiPresetInstalled = true;
    flow.detected.installedFeatureIds = ['custom-menu'];
    flow.selection.option = 'remove';
    flow.selection.optionalCleanupIds = ['screensaver'];
    flow.selection.backupChoice = 'skip';

    flow.resetNickelMenuState();

    assert.equal(flow.detected.webuiPresetInstalled, false);
    assert.deepEqual(flow.detected.installedFeatureIds, []);
    assert.equal(flow.selection.option, null);
    assert.deepEqual(flow.selection.optionalCleanupIds, []);
    assert.equal(flow.selection.backupChoice, null);
    assert.equal(flow.session.koboUserCount, undefined, '`undefined`, not null — it is what re-arms the probe');
});

// --- the device reconnect ---------------------------------------------------

test('a NickelMenu device reconnect forgets the probe results and keeps the user choices', () => {
    // The line the whole split is drawn along. `resetDeviceContext` throws away
    // what we learned from the device; it must not discard what the user picked,
    // or reconnecting a Kobo would silently reset their configuration.
    const flow = makeNickelMenuFlow();
    flow.detected.previousFeatureIds = ['custom-menu'];
    flow.detected.previousConfiguration = { selectedFeatureIds: ['custom-menu'] };
    flow.detected.installedFeatureIds = ['custom-menu'];
    flow.detected.optionalCleanupFeatures = [{ id: 'screensaver' }];
    flow.selection.option = 'preset';
    flow.selection.selectedFeatureIds = ['screensaver'];
    flow.outcome.mode = 'written';
    flow.outcome.zip = new Uint8Array([1, 2, 3]);

    flow.resetDeviceContext();

    assert.deepEqual(flow.detected.previousFeatureIds, []);
    assert.equal(flow.detected.previousConfiguration, null);
    assert.deepEqual(flow.detected.installedFeatureIds, []);
    assert.deepEqual(flow.detected.optionalCleanupFeatures, [{ id: 'screensaver' }], 'a reconnect must not re-arm cleanup detection');

    assert.equal(flow.selection.option, 'preset', 'the user kept their choice');
    assert.deepEqual(flow.selection.selectedFeatureIds, ['screensaver']);

    assert.equal(flow.outcome.zip, null, 'the built ZIP is stale once the device changes');
    assert.equal(flow.outcome.mode, 'written', 'the mode is deliberately left — see NickelMenuOutcome.clear()');
});

test('a patches device reconnect clears the built tgz and its file entries together', () => {
    // The Phase 3 fix, named: before this, `resetDeviceContext` cleared
    // `resultTgz` and left `additionalFileEntries` behind. Nothing enforced the
    // pairing, and the manifest written to a device records the entry list
    // alongside a checksum over an archive built from it — a stale list against a
    // fresh archive is a manifest that can never verify.
    //
    // Both fields are asserted in one test on purpose. Two separate tests would
    // both keep passing while the pairing rotted, which is exactly how the
    // original omission survived.
    const flow = makePatchesFlow();
    flow.build.tgz = new Uint8Array([1, 2, 3]);
    flow.build.additionalFileEntries = [{ path: 'extra.txt', data: new Uint8Array([1]), sourceName: 'extra.txt', size: 1 }];

    flow.resetDeviceContext();

    assert.deepEqual({ tgz: flow.build.tgz, entries: flow.build.additionalFileEntries }, { tgz: null, entries: [] });
});

test('a patches device reconnect also drops the reload offer', () => {
    const flow = makePatchesFlow();
    const banner = flow.patches.reloadBanner;
    banner.manifest = { files: [] };
    banner.additionalFiles = [{ destination: 'extra.txt', sourceName: 'extra.txt', data: new Uint8Array([1]) }];

    flow.resetDeviceContext();

    assert.equal(banner.manifest, null);
    assert.equal(banner.additionalFiles, null);
});
