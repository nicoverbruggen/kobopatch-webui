import test from 'node:test';
import assert from 'node:assert/strict';

import { NickelMenuSelection } from '../../src/js/flows/nickelmenu/NickelMenuSelection.js';
import { NickelMenuOutcome } from '../../src/js/flows/nickelmenu/NickelMenuOutcome.js';
import { PatchesBuild } from '../../src/js/flows/patches/PatchesBuild.js';
import { isDefaultMenuCustomization } from '../../src/js/nickelmenu/MenuCustomization.js';

// The three state objects Phase 3 split out of `Session`. What matters about each
// is its *lifetime* — which reset clears it and which deliberately does not —
// because that is the line the split is drawn along and the thing a later change
// is most likely to blur.

// --- NickelMenuSelection ----------------------------------------------------

test('a fresh selection has no option, no features, and default customizations', () => {
    const selection = new NickelMenuSelection();

    assert.equal(selection.option, null);
    assert.deepEqual(selection.selectedFeatureIds, []);
    assert.deepEqual(selection.optionalCleanupIds, []);
    assert.equal(selection.keepLegacyConfig, false);
    assert.equal(selection.backupChoice, null);
    assert.equal(isDefaultMenuCustomization(selection.menuCustomization), true);
    assert.ok(selection.tabsCustomization);
    assert.ok(selection.fontsCustomization);
});

test('resetProbeDependentChoices clears the probe-driven choices and leaves the customizations', () => {
    // The two halves are separate because `resetNickelMenuState` runs them at
    // different points, around two screen resets. Merging them would change that
    // ordering silently.
    const selection = new NickelMenuSelection();
    selection.option = 'remove';
    selection.selectedFeatureIds = ['custom-menu'];
    selection.optionalCleanupIds = ['screensaver'];
    selection.keepLegacyConfig = true;
    selection.backupChoice = 'key-files';
    selection.menuCustomization = { label: 'Tools', icon: { type: 'default' } };

    selection.resetProbeDependentChoices();

    assert.equal(selection.option, null);
    assert.deepEqual(selection.selectedFeatureIds, []);
    assert.deepEqual(selection.optionalCleanupIds, []);
    assert.equal(selection.keepLegacyConfig, false);
    assert.equal(selection.backupChoice, 'key-files', 'the backup choice belongs to the other half');
    assert.equal(selection.menuCustomization.label, 'Tools', 'the customizations belong to the other half');
});

test('resetCustomizations clears the customizations and leaves the probe-driven choices', () => {
    const selection = new NickelMenuSelection();
    selection.option = 'preset';
    selection.selectedFeatureIds = ['custom-menu'];
    selection.backupChoice = 'skip';
    selection.menuCustomization = { label: 'Tools', icon: { type: 'default' } };

    selection.resetCustomizations();

    assert.equal(selection.backupChoice, null);
    assert.equal(isDefaultMenuCustomization(selection.menuCustomization), true);
    assert.equal(selection.option, 'preset', 'the option belongs to the other half');
    assert.deepEqual(selection.selectedFeatureIds, ['custom-menu']);
});

test('reset clears both halves', () => {
    const selection = new NickelMenuSelection();
    selection.option = 'remove';
    selection.selectedFeatureIds = ['a'];
    selection.optionalCleanupIds = ['b'];
    selection.keepLegacyConfig = true;
    selection.backupChoice = 'skip';
    selection.menuCustomization = { label: 'Tools', icon: { type: 'default' } };

    selection.reset();

    assert.deepEqual(
        {
            option: selection.option,
            selectedFeatureIds: selection.selectedFeatureIds,
            optionalCleanupIds: selection.optionalCleanupIds,
            keepLegacyConfig: selection.keepLegacyConfig,
            backupChoice: selection.backupChoice,
        },
        { option: null, selectedFeatureIds: [], optionalCleanupIds: [], keepLegacyConfig: false, backupChoice: null },
    );
    assert.equal(isDefaultMenuCustomization(selection.menuCustomization), true);
});

test('each reset installs a fresh customization object rather than reusing one', () => {
    // The drafts are cloned from these, so handing back the same object would let
    // a later edit reach through a reset.
    const selection = new NickelMenuSelection();
    const before = selection.menuCustomization;

    selection.resetCustomizations();

    assert.notEqual(selection.menuCustomization, before);
});

// --- NickelMenuOutcome ------------------------------------------------------

test('a fresh outcome has neither a mode nor a ZIP', () => {
    const outcome = new NickelMenuOutcome();

    assert.equal(outcome.mode, null);
    assert.equal(outcome.zip, null);
});

test('clear forgets the ZIP but deliberately leaves the mode alone', () => {
    // `renderNmDoneStatus` branches remove / written / *else download*, so a null
    // mode is not a neutral value — it takes the same branch as 'download'.
    // Clearing it would protect nothing, and it is a behavior change on the
    // device-write path. The protection is that `executeNmInstall` sets the mode
    // on every exit path before navigating to the done screen.
    const outcome = new NickelMenuOutcome();
    outcome.mode = 'written';
    outcome.zip = new Uint8Array([1, 2, 3]);

    outcome.clear();

    assert.equal(outcome.zip, null);
    assert.equal(outcome.mode, 'written', 'clearing the mode would buy nothing — see the note on clear()');
});

// --- PatchesBuild -----------------------------------------------------------

test('a fresh build has no tgz and an empty entry list', () => {
    const build = new PatchesBuild();

    assert.equal(build.tgz, null);
    assert.deepEqual(build.additionalFileEntries, []);
});

test('clear forgets the tgz and the entry list together', () => {
    // The pairing is the whole point: the manifest records the entries and a
    // checksum over an archive built from them, so a stale entry list surviving a
    // cleared tgz is what produces a manifest that can never verify. Asserting
    // both in one test is deliberate — two separate tests would let the pairing
    // rot while both still passed.
    const build = new PatchesBuild();
    build.tgz = new Uint8Array([1, 2, 3]);
    build.additionalFileEntries = [{ path: 'extra.txt', data: new Uint8Array([1]), sourceName: 'extra.txt', size: 1 }];

    build.clear();

    assert.deepEqual({ tgz: build.tgz, additionalFileEntries: build.additionalFileEntries }, { tgz: null, additionalFileEntries: [] });
});
