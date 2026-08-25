import test from 'node:test';
import assert from 'node:assert/strict';

import {
    featuresToInstall,
    featureDisabledReason,
    subFeatures,
    parentIsCovered,
    optionalCleanupToRemove,
    optionalCleanupKept,
    featureReviewNotices,
    nmReviewModel,
} from '../../src/js/nickelmenu/selection.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/features/index.js';

// `featuresToInstall` reads the real NICKELMENU_FEATURES catalog (per the
// "test real feature modules" rule); the rest are pure over their arguments, so
// we exercise them with fabricated detected-cleanup objects.

function session(overrides = {}) {
    return {
        nickelMenuOption: 'preset',
        selectedFeatureIds: [],
        installedParentFeatureIds: [],
        nmOptionalCleanupIds: [],
        ...overrides,
    };
}

function fakeCleanup(id, title, notices = []) {
    return { id, cleanup: { title }, reviewNotices: () => notices };
}

test('featuresToInstall always includes required features, even when nothing is selected', () => {
    const result = featuresToInstall(session({ selectedFeatureIds: [] }), { firmware: '4.40.0' });
    assert.ok(
        result.some((f) => f.id === 'custom-menu'),
        'required custom-menu is always installed',
    );
});

test('featuresToInstall includes selected optional features and excludes unselected ones', () => {
    const result = featuresToInstall(session({ selectedFeatureIds: ['screensaver'] }), { firmware: '4.40.0' });
    const ids = result.map((f) => f.id);
    assert.ok(ids.includes('screensaver'), 'a selected feature is installed');
    assert.ok(!ids.includes('koreader'), 'an unselected feature is not installed');
});

test('featuresToInstall gates a feature below its minimum firmware', () => {
    const sess = session({ selectedFeatureIds: ['sideloaded-mode'] });
    const old = featuresToInstall(sess, { firmware: '4.20.0' }).map((f) => f.id);
    const recent = featuresToInstall(sess, { firmware: '4.40.0' }).map((f) => f.id);
    assert.ok(!old.includes('sideloaded-mode'), 'excluded below minimumVersion 4.31');
    assert.ok(recent.includes('sideloaded-mode'), 'included at or above minimumVersion 4.31');
});

test('featuresToInstall does not gate when firmware is unknown (manual mode)', () => {
    const result = featuresToInstall(session({ selectedFeatureIds: ['sideloaded-mode'] }), null);
    assert.ok(
        result.some((f) => f.id === 'sideloaded-mode'),
        'no firmware floor blindly applied',
    );
});

test('featuresToInstall drops a feature marked disabled, even when selected', () => {
    // `disabled: true` is a maintainer's temporary kill switch, independent of
    // asset availability (screensaver has no `available` flag at all).
    const screensaver = NICKELMENU_FEATURES.find((f) => f.id === 'screensaver');
    const sess = session({ selectedFeatureIds: ['screensaver'] });
    assert.ok(featuresToInstall(sess, { firmware: '4.40.0' }).some((f) => f.id === 'screensaver'));

    screensaver.disabled = true;
    try {
        const ids = featuresToInstall(sess, { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(!ids.includes('screensaver'), 'a disabled feature is never installed');
    } finally {
        delete screensaver.disabled;
    }
});

test('featuresToInstall drops a feature hidden from the install catalogue, even when selected', () => {
    const nickelCoverFix = NICKELMENU_FEATURES.find((f) => f.id === 'nickelcoverfix');
    const originalAvailable = nickelCoverFix.available;
    nickelCoverFix.available = true;
    try {
        const ids = featuresToInstall(session({ selectedFeatureIds: ['nickelcoverfix'] }), null).map((f) => f.id);
        assert.ok(!ids.includes('nickelcoverfix'), 'a hidden feature is never installed');
    } finally {
        nickelCoverFix.available = originalAvailable;
    }
});

test('featuresToInstall drops a disabled feature even when its asset is available', () => {
    // An installable-backed feature stays uninstallable while disabled, no
    // matter what the availability manifest says.
    const nickelCoverFix = NICKELMENU_FEATURES.find((f) => f.id === 'nickelcoverfix');
    const originalAvailable = nickelCoverFix.available;
    const originalDisabled = nickelCoverFix.disabled;
    const originalHidden = nickelCoverFix.hidden;
    const sess = session({ selectedFeatureIds: ['nickelcoverfix'] });

    nickelCoverFix.available = true;
    delete nickelCoverFix.hidden; // establish a visible baseline (it may ship hidden)
    delete nickelCoverFix.disabled; // establish an enabled baseline (it may ship disabled)
    try {
        assert.ok(featuresToInstall(sess, { firmware: '4.40.0' }).some((f) => f.id === 'nickelcoverfix'));
        nickelCoverFix.disabled = true;
        const ids = featuresToInstall(sess, { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(!ids.includes('nickelcoverfix'), 'disabled wins over available');
    } finally {
        nickelCoverFix.available = originalAvailable;
        if (originalHidden === undefined) delete nickelCoverFix.hidden;
        else nickelCoverFix.hidden = originalHidden;
        if (originalDisabled === undefined) delete nickelCoverFix.disabled;
        else nickelCoverFix.disabled = originalDisabled;
    }
});

test('featuresToInstall also drops a feature disabled with a string reason', () => {
    const nickelCoverFix = NICKELMENU_FEATURES.find((f) => f.id === 'nickelcoverfix');
    const originalAvailable = nickelCoverFix.available;
    const originalDisabled = nickelCoverFix.disabled;
    const originalHidden = nickelCoverFix.hidden;
    const sess = session({ selectedFeatureIds: ['nickelcoverfix'] });

    nickelCoverFix.available = true;
    delete nickelCoverFix.hidden;
    nickelCoverFix.disabled = 'Off while a fix is prepared.';
    try {
        assert.ok(!featuresToInstall(sess, { firmware: '4.40.0' }).some((f) => f.id === 'nickelcoverfix'), 'a string reason still disables install');
    } finally {
        nickelCoverFix.available = originalAvailable;
        if (originalHidden === undefined) delete nickelCoverFix.hidden;
        else nickelCoverFix.hidden = originalHidden;
        if (originalDisabled === undefined) delete nickelCoverFix.disabled;
        else nickelCoverFix.disabled = originalDisabled;
    }
});

// SimpleUI is a KOReader plugin: it declares `parent: 'koreader'` and installs
// into KOReader's own directory, so it only travels with KOReader. Both ship
// `available: false` (the build manifest flips them at runtime), so these
// temporarily mark them available, the way the tests above do.
function withReadingAppsAvailable(run) {
    const koreader = NICKELMENU_FEATURES.find((f) => f.id === 'koreader');
    const simpleui = NICKELMENU_FEATURES.find((f) => f.id === 'simpleui');
    const originals = [koreader.available, simpleui.available];
    koreader.available = true;
    simpleui.available = true;
    try {
        run(koreader, simpleui);
    } finally {
        koreader.available = originals[0];
        simpleui.available = originals[1];
    }
}

test('subFeatures lists the features that declare a given parent', () => {
    const ids = subFeatures('koreader').map((f) => f.id);
    assert.deepEqual(ids, ['simpleui'], 'SimpleUI is a subitem of KOReader');
    assert.deepEqual(subFeatures('simpleui'), [], 'nesting is one level deep');
});

test('parentIsCovered is true when the parent is selected or already on the device', () => {
    assert.equal(parentIsCovered('koreader', session({ selectedFeatureIds: ['koreader'] })), true);
    assert.equal(parentIsCovered('koreader', session({ installedParentFeatureIds: ['koreader'] })), true);
    assert.equal(parentIsCovered('koreader', session()), false, 'nothing to plug into');
});

test('featuresToInstall drops a subitem whose parent is neither selected nor installed', () => {
    withReadingAppsAvailable(() => {
        const ids = featuresToInstall(session({ selectedFeatureIds: ['simpleui'] }), { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(!ids.includes('simpleui'), 'a KOReader plugin without KOReader is not installed');
    });
});

test('featuresToInstall keeps a subitem when its parent is part of the same install', () => {
    withReadingAppsAvailable(() => {
        const ids = featuresToInstall(session({ selectedFeatureIds: ['koreader', 'simpleui'] }), { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(ids.includes('koreader') && ids.includes('simpleui'));
    });
});

test('featuresToInstall keeps a subitem when its parent is already on the device', () => {
    withReadingAppsAvailable(() => {
        const sess = session({ selectedFeatureIds: ['simpleui'], installedParentFeatureIds: ['koreader'] });
        const ids = featuresToInstall(sess, { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(ids.includes('simpleui'), 'the plugin can be added on its own');
        assert.ok(!ids.includes('koreader'), 'without reinstalling KOReader');
    });
});

test('featuresToInstall drops a subitem when its parent is filtered out for another reason', () => {
    // KOReader ticked but unavailable in this deployment: the plugin must not
    // be written into a directory that will not exist.
    const simpleui = NICKELMENU_FEATURES.find((f) => f.id === 'simpleui');
    const koreader = NICKELMENU_FEATURES.find((f) => f.id === 'koreader');
    const originals = [koreader.available, simpleui.available];
    koreader.available = false;
    simpleui.available = true;
    try {
        const ids = featuresToInstall(session({ selectedFeatureIds: ['koreader', 'simpleui'] }), { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(!ids.includes('koreader') && !ids.includes('simpleui'));
    } finally {
        koreader.available = originals[0];
        simpleui.available = originals[1];
    }
});

test('featureDisabledReason surfaces the right message for each disabled cause', () => {
    // A string kill switch is shown verbatim; `true` uses the generic text.
    assert.equal(featureDisabledReason({ disabled: 'Being reworked.' }, { firmware: '4.40.0' }), 'Being reworked.');
    assert.equal(featureDisabledReason({ disabled: true }, { firmware: '4.40.0' }), 'Temporarily unavailable.');
    // An unbundled asset also reads as temporarily unavailable.
    assert.equal(featureDisabledReason({ available: false }, { firmware: '4.40.0' }), 'Temporarily unavailable.');
    // Device-specific reasons when not globally disabled.
    assert.match(featureDisabledReason({ minimumVersion: '4.41' }, { firmware: '4.30.0' }), /Requires Kobo software 4\.41/);
    assert.equal(featureDisabledReason({ unsupportedDeviceReason: () => 'No good here.' }, { firmware: '4.40.0' }), 'No good here.');
    // A selectable feature has no reason.
    assert.equal(featureDisabledReason({}, { firmware: '4.40.0' }), undefined);
    // A subitem waiting on its parent is not a reason: the list hides its whole
    // group instead of showing a greyed-out row.
    assert.equal(featureDisabledReason({ parent: 'koreader' }, { firmware: '4.40.0' }), undefined);
    // The global kill switch wins over device-specific reasons.
    assert.equal(
        featureDisabledReason({ disabled: 'Off for now.', minimumVersion: '9.99', unsupportedDeviceReason: () => 'nope' }, { firmware: '4.30.0' }),
        'Off for now.',
    );
});

test('optionalCleanupToRemove / optionalCleanupKept partition detected by the checked ids', () => {
    const detected = [fakeCleanup('a', 'A'), fakeCleanup('b', 'B'), fakeCleanup('c', 'C')];
    const sess = session({ nmOptionalCleanupIds: ['a', 'c'] });
    assert.deepEqual(
        optionalCleanupToRemove(sess, detected).map((f) => f.id),
        ['a', 'c'],
    );
    assert.deepEqual(
        optionalCleanupKept(sess, detected).map((f) => f.id),
        ['b'],
    );
});

test('featureReviewNotices flattens notices and forwards deviceInfo', () => {
    let seen = null;
    const features = [
        {
            reviewNotices: (ctx) => {
                seen = ctx.deviceInfo;
                return [{ title: 'one' }];
            },
        },
        {/* no reviewNotices */},
        { reviewNotices: () => [{ title: 'two' }] },
    ];
    const notices = featureReviewNotices(features, { firmware: '4.40.0' });
    assert.deepEqual(
        notices.map((n) => n.title),
        ['one', 'two'],
    );
    assert.deepEqual(seen, { firmware: '4.40.0' });
});

test('featureReviewNotices de-duplicates identical notices (shared across features)', () => {
    // The home-screen hiders each contribute the same NickelHome notice; it should appear once.
    const shared = { type: 'info', title: 'NickelHome', paragraphs: ['x'] };
    const features = [{ reviewNotices: () => [shared] }, { reviewNotices: () => [{ ...shared }] }, { reviewNotices: () => [{ title: 'other' }] }];
    const notices = featureReviewNotices(features, {});
    assert.deepEqual(
        notices.map((n) => n.title),
        ['NickelHome', 'other'],
    );
});

test('nmReviewModel (remove) reports removed vs kept from the detected cleanups', () => {
    const detected = [fakeCleanup('a', 'A'), fakeCleanup('b', 'B')];
    const model = nmReviewModel(session({ nickelMenuOption: 'remove', nmOptionalCleanupIds: ['a'] }), detected, {
        firmware: '4.40.0',
    });
    assert.equal(model.mode, 'remove');
    assert.deepEqual(
        model.removedFeatures.map((f) => f.id),
        ['a'],
    );
    assert.deepEqual(
        model.keptFeatures.map((f) => f.id),
        ['b'],
    );
});

test('nmReviewModel (preset) lists the install features including required ones', () => {
    const model = nmReviewModel(session({ nickelMenuOption: 'preset', selectedFeatureIds: ['screensaver'] }), [], {
        firmware: '4.40.0',
    });
    assert.equal(model.mode, 'preset');
    const ids = model.installFeatures.map((f) => f.id);
    assert.ok(ids.includes('custom-menu') && ids.includes('screensaver'));
    assert.ok(Array.isArray(model.notices));
});
