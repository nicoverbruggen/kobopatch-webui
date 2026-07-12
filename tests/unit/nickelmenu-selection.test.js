import test from 'node:test';
import assert from 'node:assert/strict';

import { featuresToInstall, optionalCleanupToRemove, optionalCleanupKept, featureReviewNotices, nmReviewModel } from '../../src/js/nickelmenu/selection.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/features/index.js';

// `featuresToInstall` reads the real NICKELMENU_FEATURES catalog (per the
// "test real feature modules" rule); the rest are pure over their arguments, so
// we exercise them with fabricated detected-cleanup objects.

function session(overrides = {}) {
    return {
        nickelMenuOption: 'preset',
        selectedFeatureIds: [],
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

test('featuresToInstall drops a disabled feature even when its asset is available', () => {
    // An installable-backed feature stays uninstallable while disabled, no
    // matter what the availability manifest says.
    const nickelCoverFix = NICKELMENU_FEATURES.find((f) => f.id === 'nickelcoverfix');
    const originalAvailable = nickelCoverFix.available;
    const originalDisabled = nickelCoverFix.disabled;
    const sess = session({ selectedFeatureIds: ['nickelcoverfix'] });

    nickelCoverFix.available = true;
    delete nickelCoverFix.disabled; // establish an enabled baseline (it may ship disabled)
    try {
        assert.ok(featuresToInstall(sess, { firmware: '4.40.0' }).some((f) => f.id === 'nickelcoverfix'));
        nickelCoverFix.disabled = true;
        const ids = featuresToInstall(sess, { firmware: '4.40.0' }).map((f) => f.id);
        assert.ok(!ids.includes('nickelcoverfix'), 'disabled wins over available');
    } finally {
        nickelCoverFix.available = originalAvailable;
        if (originalDisabled === undefined) delete nickelCoverFix.disabled;
        else nickelCoverFix.disabled = originalDisabled;
    }
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
        {
            /* no reviewNotices */
        },
        { reviewNotices: () => [{ title: 'two' }] },
    ];
    const notices = featureReviewNotices(features, { firmware: '4.40.0' });
    assert.deepEqual(
        notices.map((n) => n.title),
        ['one', 'two'],
    );
    assert.deepEqual(seen, { firmware: '4.40.0' });
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

test('nmReviewModel (nickelmenu-only) installs no preset features', () => {
    const model = nmReviewModel(session({ nickelMenuOption: 'nickelmenu-only', selectedFeatureIds: ['screensaver'] }), [], { firmware: '4.40.0' });
    assert.equal(model.mode, 'nickelmenu-only');
    assert.deepEqual(model.installFeatures, []);
    assert.deepEqual(model.notices, []);
});
