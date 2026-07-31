import './dom-harness.js'; // the step constructors look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { FeaturesStep } from '../../src/js/flows/nickelmenu/FeaturesStep.js';
import { DetectedInstallation } from '../../src/js/flows/nickelmenu/DetectedInstallation.js';
import { CustomizationDrafts } from '../../src/js/flows/nickelmenu/CustomizationDrafts.js';
import { NickelMenuSelection } from '../../src/js/flows/nickelmenu/NickelMenuSelection.js';
import { CustomizationDialogs } from '../../src/js/flows/nickelmenu/CustomizationDialogs.js';
import { createDefaultMenuCustomization } from '../../src/js/nickelmenu/customization.js';

// Baseline for every expectation here is `nickelmenu-flow.js` at `e18299f`:
// the features step's onEnter (276-282), `restorePreviousConfiguration`
// (753-782), `renderFeatureCheckboxes` (440-512) and
// `updateSideloadedRecommendation` (727-745).
//
// Two of these behaviors have no other test anywhere in the repo:
// `btn-nm-use-previous-configuration` appears in no E2E or unit spec, so the
// object-URL rebuild and the "explicit restore beats the automatic one" half of
// the once-only guard are covered by this file alone.

function makeSession(overrides = {}) {
    return {
        device: { deviceInfo: { firmware: '4.41.23145' }, directoryHandle: {} },
        manualMode: false,
        koboUserCount: undefined,
        ...overrides,
    };
}

// Steps wire listeners onto markup that outlives them, so every one built here
// is torn down when its test ends. Without that, a later test's gesture would
// also run this test's handlers against a stale session.
const built = [];
function makeStep(session, probed = {}) {
    const selection = new NickelMenuSelection();
    const detected = new DetectedInstallation();
    // What the config screen's probe would have recorded before this screen runs.
    Object.assign(detected, probed);
    const drafts = new CustomizationDrafts(selection);
    // A *real* registry, not a stub: the restore behavior these tests exist for —
    // the object-URL rebuild, the per-feature gates, the menu draft handoff —
    // moved into the dialog subclasses in Phase 5, so stubbing it would leave
    // this file asserting nothing.
    const listeners = new AbortController();
    const dialogs = new CustomizationDialogs(session, selection, drafts, listeners.signal);
    const owner = { session, detected, selection, drafts, dialogs };
    const step = new FeaturesStep(owner);
    built.push({ destroy: () => listeners.abort() }, step);
    return { step, owner, selection, detected, dialogs };
}

test.afterEach(() => {
    while (built.length) built.pop().destroy();
});

/** Swap in a counting `URL.createObjectURL` for the duration of `run`. */
async function withObjectUrlSpy(run) {
    const original = URL.createObjectURL;
    const calls = [];
    URL.createObjectURL = (blob) => {
        calls.push(blob);
        return `blob:stub/${calls.length}`;
    };
    try {
        await run(calls);
    } finally {
        URL.createObjectURL = original;
    }
}

function previousConfigWithUploadedIcon() {
    return {
        selectedFeatureIds: ['custom-menu'],
        menuCustomization: {
            label: 'Tools',
            icon: { type: 'upload', name: 'icon.png', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) },
        },
    };
}

test('restoring a previous configuration rebuilds the icon preview URL', async () => {
    // The icon comes off the device as bytes with no `previewUrl`, and every
    // consumer keys on `previewUrl` — without the rebuild the restored icon
    // silently renders as the default cog.
    await withObjectUrlSpy(async (calls) => {
        const session = makeSession();
        const { step, selection } = makeStep(session, { previousConfiguration: previousConfigWithUploadedIcon() });

        step.restorePreviousConfiguration(false, false);

        assert.equal(calls.length, 1);
        assert.equal(typeof selection.menuCustomization.icon.previewUrl, 'string');
    });
});

test('restoring twice does not mint a second object URL', async () => {
    // The URL is cached on `previous.menuCustomization.icon` — the source object,
    // which lives for the whole flow — *before* cloning. Building it on the clone
    // instead still renders correctly the first time, so only the call count
    // catches it, and nothing in this app revokes an object URL.
    await withObjectUrlSpy(async (calls) => {
        const previous = previousConfigWithUploadedIcon();
        const session = makeSession();
        const { step, selection } = makeStep(session, { previousConfiguration: previous });

        step.restorePreviousConfiguration(false, false);
        const firstUrl = selection.menuCustomization.icon.previewUrl;
        step.restorePreviousConfiguration(false, false);

        assert.equal(calls.length, 1);
        assert.equal(selection.menuCustomization.icon.previewUrl, firstUrl);
        assert.equal(previous.menuCustomization.icon.previewUrl, firstUrl, 'the URL is cached on the source icon');
    });
});

test('an icon that already has a preview URL is left alone', async () => {
    await withObjectUrlSpy(async (calls) => {
        const previous = previousConfigWithUploadedIcon();
        previous.menuCustomization.icon.previewUrl = 'blob:existing';
        const session = makeSession();
        const { step, selection } = makeStep(session, { previousConfiguration: previous });

        step.restorePreviousConfiguration(false, false);

        assert.equal(calls.length, 0);
        assert.equal(selection.menuCustomization.icon.previewUrl, 'blob:existing');
    });
});

test('a non-upload icon never builds an object URL', async () => {
    await withObjectUrlSpy(async (calls) => {
        const previous = previousConfigWithUploadedIcon();
        previous.menuCustomization.icon = { type: 'preset', id: 'cog' };
        const session = makeSession();
        const { step, selection } = makeStep(session, { previousConfiguration: previous });

        step.restorePreviousConfiguration(false, false);

        assert.equal(calls.length, 0);
    });
});

test('restoring the menu customization replaces the draft and ends the menu session', () => {
    const session = makeSession();
    const { step, owner } = makeStep(session, {
        previousConfiguration: { selectedFeatureIds: [], menuCustomization: { label: 'Tools', icon: { type: 'default' } } },
    });
    const token = owner.drafts.menuToken();

    step.restorePreviousConfiguration(false, false);

    assert.equal(owner.drafts.isCurrentMenu(token), false, 'an in-flight icon upload must not survive a restore');
    assert.equal(owner.drafts.menu.label, 'Tools');
});

test('a previous configuration without a menu customization leaves the draft untouched', () => {
    // Baseline 761: the whole menu branch is inside `if (previous?.menuCustomization)`,
    // so an in-flight upload deliberately survives this restore.
    const session = makeSession();
    const { step, owner } = makeStep(session, { previousConfiguration: { selectedFeatureIds: ['custom-menu'] } });
    const token = owner.drafts.menuToken();

    step.restorePreviousConfiguration(false, false);

    assert.equal(owner.drafts.isCurrentMenu(token), true);
});

test('restore returns false and does nothing when there is neither a manifest nor installed state to use', () => {
    const session = makeSession();
    const { step, owner } = makeStep(session);

    assert.equal(step.restorePreviousConfiguration(false, false), false);
    assert.equal(owner.detected.previousConfigurationApplied, false);
});

test('restore proceeds from installed state even with no previous manifest', () => {
    // `useInstalledState` flips the early return, so the auto-seed on entering
    // the features step works on a device with a webui preset but no readable
    // manifest.
    const session = makeSession();
    const { step, owner, selection } = makeStep(session, { installedFeatureIds: ['sideloaded-mode'] });

    assert.equal(step.restorePreviousConfiguration(true, false), true);
    assert.ok(selection.selectedFeatureIds.includes('sideloaded-mode'));
    assert.equal(owner.detected.previousConfigurationApplied, true);
});

test('entering the features step auto-restores once, and not again', async () => {
    const session = makeSession({ koboUserCount: null });
    const { step, owner, selection } = makeStep(session, { installedFeatureIds: ['sideloaded-mode'] });
    owner.detected.webuiPresetInstalled = true;

    const calls = [];
    const real = step.restorePreviousConfiguration.bind(step);
    step.restorePreviousConfiguration = (...args) => {
        calls.push(args);
        return real(...args);
    };

    await step.onEnter(session);
    await step.onEnter(session);

    assert.equal(calls.length, 1);
    // `render: false` matters: onEnter renders on the very next line, and
    // `renderFeatureCheckboxes` only seeds defaults when the selection is still
    // empty, so the restore has to run first and render once.
    assert.deepEqual(calls[0], [true, false]);
});

test('an explicit restore stops the automatic one from overwriting it', async () => {
    // The "use previous configuration" button sets the same flag the auto-seed
    // checks. This is the half of the guard with no coverage anywhere else: if
    // the flag were private to the features step's entry logic, the user's
    // explicit choice would be silently overwritten on the next entry.
    const session = makeSession({ koboUserCount: null });
    const { step, owner, selection } = makeStep(session, { installedFeatureIds: ['sideloaded-mode'] });
    owner.detected.webuiPresetInstalled = true;
    owner.detected.previousConfiguration = { selectedFeatureIds: ['exclude-calibre'] };

    // The user clicks "use previous configuration" on this screen.
    step.restorePreviousConfiguration(false);
    const chosen = [...selection.selectedFeatureIds];

    await step.onEnter(session);

    assert.deepEqual(selection.selectedFeatureIds, chosen);
});

test('rendering the checkbox list seeds defaults only when nothing is selected', async () => {
    const session = makeSession();
    const { step, selection } = makeStep(session);

    step.renderFeatureCheckboxes();
    const defaults = [...selection.selectedFeatureIds];
    assert.ok(defaults.length > 0);

    selection.selectedFeatureIds = ['custom-menu'];
    step.renderFeatureCheckboxes();

    assert.deepEqual(selection.selectedFeatureIds, ['custom-menu'], 're-entering the step must not wipe the user’s choices');
});

test('the sideload recommendation opens the section its feature lives in', async () => {
    // The tail of `updateSideloadedRecommendation` is the part no other test in
    // the repo reaches, and the caller's `.catch(() => {})` would swallow any
    // TypeError in it. Awaiting the method directly is what makes a break here
    // visible at all.
    const session = makeSession({ koboUserCount: 0 });
    const { step } = makeStep(session);

    step.renderFeatureCheckboxes();
    await step.updateSideloadedRecommendation();

    assert.equal(step.sideloadedBanner.hidden, false);
    const advanced = [...step.configOptions.querySelectorAll('.nm-config-section')].find(
        (section) => section.querySelector('.nm-config-section-title')?.textContent === 'Advanced',
    );
    assert.ok(advanced, 'the Advanced section should have been rendered');
    assert.equal(advanced.open, true, 'Advanced is collapsed by default and must be opened for the recommendation');
});

test('the sideload banner stays hidden when the device has a Kobo account', async () => {
    const session = makeSession({ koboUserCount: 2 });
    const { step } = makeStep(session);
    step.sideloadedBanner.hidden = false; // the document is shared, so prove it gets hidden

    step.renderFeatureCheckboxes();
    await step.updateSideloadedRecommendation();

    assert.equal(step.sideloadedBanner.hidden, true);
});

test('a device that cannot be read leaves the banner hidden without throwing', async () => {
    // `countTableRows` catches its own failures and returns null, so a broken
    // device read reaches `getKoboUserCount` as a value rather than a rejection
    // and is cached as null. Pinning that here because the opposite — a rejection
    // that is retried on the next entry — is an easy thing to assume.
    const session = makeSession({
        device: {
            deviceInfo: { firmware: '4.41.23145' },
            directoryHandle: {},
            readFileRange: () => {
                throw new Error('device disconnected');
            },
        },
    });
    const { step } = makeStep(session);
    step.sideloadedBanner.hidden = false; // the document is shared, so prove it gets hidden

    step.renderFeatureCheckboxes();
    await step.updateSideloadedRecommendation();

    assert.equal(session.koboUserCount, null);
    assert.equal(step.sideloadedBanner.hidden, true);
});

test('entering the step does not wait for, or fail on, the recommendation', async () => {
    // Fire and forget. The caller's `.catch(() => {})` swallows everything the
    // method can throw, so `onEnter` must resolve and the checkbox list must
    // already be rendered rather than waiting behind a device read.
    const session = makeSession({ koboUserCount: null });
    const { step } = makeStep(session);
    step.updateSideloadedRecommendation = async () => {
        throw new Error('recommendation blew up');
    };

    const rejections = [];
    const onRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
        await step.onEnter(session);
        assert.ok(step.configOptions.querySelector('input'), 'the list renders without waiting for the probe');
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        process.off('unhandledRejection', onRejection);
    }

    assert.deepEqual(rejections, [], 'a failed recommendation must not reach the global error screen');
});
