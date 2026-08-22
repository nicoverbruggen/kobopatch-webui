import './dom-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { supportedSideloadedModeFeature } from '../../src/js/flows/nickelmenu-flow.js';

test('a missing sideloaded-mode feature is not eligible for a recommendation', () => {
    assert.equal(supportedSideloadedModeFeature([], '4.45.0'), null);
});

test('the sideload recommendation respects the feature firmware floor', () => {
    const feature = { id: 'sideloaded-mode', minimumVersion: '4.31' };
    assert.equal(supportedSideloadedModeFeature([feature], '4.30.0'), null);
    assert.equal(supportedSideloadedModeFeature([feature], '4.31.0'), feature);
});
