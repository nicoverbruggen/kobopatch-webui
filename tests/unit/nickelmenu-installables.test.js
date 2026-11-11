import test from 'node:test';
import assert from 'node:assert/strict';

import { compareVersions, displayVersion, featureVersion, isUpgrade } from '../../src/js/nickelmenu/installables.js';

// Upstream release tags are not consistent about the `v` prefix — KOReader tags
// `v2026.07.1`, SimpleUI tags `2.5.0` — so the feature list normalizes them for
// display only. The lock and the asset URL keep the real tag.
test('displayVersion adds the v prefix only to a version that starts with a digit', () => {
    assert.equal(displayVersion('2.5.0'), 'v2.5.0');
    assert.equal(displayVersion('2026.07.1'), 'v2026.07.1');
    assert.equal(displayVersion('v0.11.0'), 'v0.11.0', 'an existing prefix is left alone');
    assert.equal(displayVersion('v2026.07.1'), 'v2026.07.1');
});

test('displayVersion passes through anything that is not a version string', () => {
    assert.equal(displayVersion(''), '');
    assert.equal(displayVersion(null), null);
    assert.equal(displayVersion(undefined), undefined);
});

test('compareVersions orders the release formats actually in use', () => {
    assert.equal(compareVersions('v2026.05.1', 'v2026.07.1'), -1);
    assert.equal(compareVersions('v2026.07.1', 'v2026.05.1'), 1);
    assert.equal(compareVersions('v2026.07.1', 'v2026.07.1'), 0);
    // The `v` prefix is optional on either side, and a shorter version is
    // padded rather than treated as larger.
    assert.equal(compareVersions('2.5.0', 'v2.5.1'), -1);
    assert.equal(compareVersions('v0.7', 'v0.7.0'), 0);
    assert.equal(compareVersions('v0.9', 'v0.10'), -1, 'compared as numbers, not as text');
});

test('compareVersions refuses to order what it cannot parse', () => {
    assert.equal(compareVersions('nightly', 'v0.7'), null);
    assert.equal(compareVersions('v0.7', ''), null);
    assert.equal(compareVersions(null, undefined), null);
});

test('isUpgrade is true only when the installed version is provably older', () => {
    const original = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = { koreader: { version: 'v2026.07.1', available: true } };
        const koreader = { id: 'koreader' };

        assert.equal(isUpgrade('v2026.05.1', koreader), true);
        assert.equal(isUpgrade('v2026.07.1', koreader), false, 'the same version is not an upgrade');
        assert.equal(isUpgrade('v2026.09.1', koreader), false, 'a newer install is left alone');
        assert.equal(isUpgrade(null, koreader), false, 'an unknown version claims nothing');
        assert.equal(isUpgrade('nightly', koreader), false, 'an unparseable version claims nothing');
        assert.equal(isUpgrade('v1.0', { id: 'not-an-installable' }), false, 'nothing bundled to compare with');
    } finally {
        globalThis.__INSTALLABLES__ = original;
    }
});

test('featureVersion prefers the version a feature declares over its id lookup', () => {
    const original = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = { koreader: { version: 'v2026.07.1', available: true } };
        assert.equal(featureVersion({ id: 'koreader' }), 'v2026.07.1');
        // better-typography ships NickelTypeFix, so its id is not the installable's.
        assert.equal(featureVersion({ id: 'better-typography', version: () => 'v0.7' }), 'v0.7');
        assert.equal(featureVersion({ id: 'exclude-calibre' }), null);
    } finally {
        globalThis.__INSTALLABLES__ = original;
    }
});
