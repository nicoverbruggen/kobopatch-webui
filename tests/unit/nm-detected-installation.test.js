import test from 'node:test';
import assert from 'node:assert/strict';

import { DetectedInstallation } from '../../src/js/flows/nickelmenu/DetectedInstallation.js';

// `needsOptionalCleanupDetection` decides whether the config screen asks the
// device probe to detect optional cleanups again. Getting it wrong re-renders
// the cleanup checkboxes as all-checked and reassigns `nmOptionalCleanupIds` to
// the full list, which is a device-removal path: the user's choice to keep a
// file would be silently undone.
//
// Baseline: `nickelmenu-flow.js:646` at `e18299f` reads
// `detectedOptionalCleanupFeatures.length === 0`, and the array is cleared only
// in `resetNickelMenuState` (585).

test('detection is needed before anything has been probed', () => {
    assert.equal(new DetectedInstallation().needsOptionalCleanupDetection, true);
});

test('detection is not needed once features have been recorded', () => {
    const detected = new DetectedInstallation();
    detected.optionalCleanupFeatures.push({ id: 'exclude-calibre' });

    assert.equal(detected.needsOptionalCleanupDetection, false);
});

test('a probe that finds nothing leaves detection needed', () => {
    // The load-bearing half. This is an emptiness test, not a "have I run
    // before" flag: on a device with NickelMenu installed but no optional
    // cleanup features present, the baseline probes again on the next visit to
    // the config screen. A boolean flag would probe once and stop.
    const detected = new DetectedInstallation();
    detected.optionalCleanupFeatures.push(...[]);

    assert.equal(detected.needsOptionalCleanupDetection, true);
});

test('reset makes detection needed again', () => {
    // Only `resetNickelMenuState` clears the list, and mode-flow calls that when
    // the user leaves for mode selection. Returning to the wizard is meant to
    // re-detect; navigating back within the wizard is not.
    const detected = new DetectedInstallation();
    detected.optionalCleanupFeatures.push({ id: 'exclude-calibre' });

    detected.reset();

    assert.equal(detected.needsOptionalCleanupDetection, true);
    assert.deepEqual(detected.optionalCleanupFeatures, []);
});

/** Every field set to a non-initial value, for the two reset tests below. */
function fullyProbed() {
    const detected = new DetectedInstallation();
    detected.optionalCleanupFeatures.push({ id: 'a' });
    detected.presetConflicts.push({ id: 'nickeldbus' });
    detected.legacyItemsDetected = true;
    detected.legacyItemsWasOurs = true;
    detected.webuiPresetInstalled = true;
    detected.previousConfigurationApplied = true;
    detected.previousFeatureIds = ['custom-menu'];
    detected.previousConfiguration = { selectedFeatureIds: ['custom-menu'] };
    detected.installedFeatureIds = ['custom-menu'];
    return detected;
}

test('reset clears every probed field', () => {
    // Baseline `resetNickelMenuState` 585-588 plus 596-597, and the three fields
    // Phase 3 moved here from `Session`.
    const detected = fullyProbed();

    detected.reset();

    assert.deepEqual(detected.optionalCleanupFeatures, []);
    assert.deepEqual(detected.presetConflicts, []);
    assert.equal(detected.legacyItemsDetected, false);
    assert.equal(detected.legacyItemsWasOurs, false);
    assert.equal(detected.webuiPresetInstalled, false);
    assert.equal(detected.previousConfigurationApplied, false);
    assert.deepEqual(detected.previousFeatureIds, []);
    assert.equal(detected.previousConfiguration, null);
    assert.deepEqual(detected.installedFeatureIds, []);
});

test('resetDeviceContext clears exactly the three fields a reconnect invalidates', () => {
    // Two reset methods, not one. `Session.resetDeviceContext()` cleared these
    // three and could not reach the other six, which were flow-local `let`s at
    // baseline. Widening this to clear all nine would discard the optional-cleanup
    // checkboxes the user has already been shown, on a device-removal path.
    const detected = fullyProbed();

    detected.resetDeviceContext();

    assert.deepEqual(detected.previousFeatureIds, []);
    assert.equal(detected.previousConfiguration, null);
    assert.deepEqual(detected.installedFeatureIds, []);

    assert.deepEqual(detected.optionalCleanupFeatures, [{ id: 'a' }], 'a reconnect must not re-arm cleanup detection');
    assert.deepEqual(detected.presetConflicts, [{ id: 'nickeldbus' }]);
    assert.equal(detected.legacyItemsDetected, true);
    assert.equal(detected.legacyItemsWasOurs, true);
    assert.equal(detected.webuiPresetInstalled, true);
    assert.equal(detected.previousConfigurationApplied, true);
});

test('the preset-conflict list has no first-visit guard', () => {
    // Deliberate asymmetry with the cleanup list: `detectHasPresetConflicts`
    // (667-670) overwrites the list on every press of Next in the preset path,
    // because it feeds a read-only acknowledgement screen. Nothing here may
    // grow a `needsPresetConflictDetection` sibling.
    const detected = new DetectedInstallation();

    assert.equal(Object.getOwnPropertyNames(DetectedInstallation.prototype).includes('needsPresetConflictDetection'), false);
    assert.deepEqual(detected.presetConflicts, []);
});
