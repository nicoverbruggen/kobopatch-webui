import test from 'node:test';
import assert from 'node:assert/strict';

import { displayVersion } from '../../src/js/nickelmenu/installables.js';

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
