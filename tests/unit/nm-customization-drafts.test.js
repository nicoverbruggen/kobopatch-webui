import './dom-harness.js'; // the customization modules read the DOM at import time

import test from 'node:test';
import assert from 'node:assert/strict';

import { CustomizationDrafts } from '../../src/js/flows/nickelmenu/CustomizationDrafts.js';
import { createDefaultMenuCustomization } from '../../src/js/nickelmenu/MenuCustomization.js';

// The menu customize dialog can have a slow icon upload in flight while the user
// closes, reopens, resets or saves. `CustomizationDrafts` carries the two-part
// staleness check that decides whether that upload is still allowed to apply.
//
// Baseline for every expectation below is `nickelmenu-flow.js` at `e18299f`:
// the captured pair at 794-795, the guards at 800 and 803, and the four writers
// that make a token stale — open (490), Save (830), Reset (810-811),
// `restorePreviousConfiguration` (767-768) and `resetNickelMenuState` (608-609).

function session() {
    return {
        menuCustomization: createDefaultMenuCustomization(),
        tabsCustomization: null,
        fontsCustomization: null,
    };
}

test('a token stays current while nothing changes', () => {
    const drafts = new CustomizationDrafts(session());
    const token = drafts.menuToken();

    assert.equal(drafts.isCurrentMenu(token), true);
});

test('replacing the draft makes an in-flight token stale', () => {
    // Baseline: `openMenuCustomizeDialog` (490) returns a fresh clone, so
    // reopening the dialog invalidates an upload started in the previous one.
    const drafts = new CustomizationDrafts(session());
    const token = drafts.menuToken();

    drafts.setMenu(createDefaultMenuCustomization());

    assert.equal(drafts.isCurrentMenu(token), false);
});

test('ending the session makes an in-flight token stale even though the draft object is unchanged', () => {
    // This is the case the generation counter exists for, and the one an
    // identity-only check gets wrong. Baseline Save (826-830) commits a spread
    // copy and leaves `nmCustomizationDraft` pointing at the very same object,
    // so only the bump at 830 invalidates an upload still resolving.
    const drafts = new CustomizationDrafts(session());
    const token = drafts.menuToken();
    const draftBefore = drafts.menu;

    drafts.endMenuSession();

    assert.equal(drafts.menu, draftBefore, 'Save must not replace the draft object');
    assert.equal(drafts.isCurrentMenu(token), false);
});

test('neither half of the token is sufficient on its own', () => {
    const drafts = new CustomizationDrafts(session());
    const token = drafts.menuToken();

    // Right generation, wrong draft.
    assert.equal(drafts.isCurrentMenu({ draft: createDefaultMenuCustomization(), generation: drafts.menuGeneration }), false);
    // Right draft, wrong generation.
    assert.equal(drafts.isCurrentMenu({ draft: drafts.menu, generation: drafts.menuGeneration + 1 }), false);
    // Both right.
    assert.equal(drafts.isCurrentMenu(token), true);
});

test('setMenu does not end the session, and endMenuSession does not replace the draft', () => {
    // The two must stay separable: baseline replaces without bumping when the
    // dialog opens, and bumps without replacing when the user saves.
    const drafts = new CustomizationDrafts(session());

    const generationBefore = drafts.menuGeneration;
    const replacement = createDefaultMenuCustomization();
    drafts.setMenu(replacement);
    assert.equal(drafts.menuGeneration, generationBefore);
    assert.equal(drafts.menu, replacement);

    drafts.endMenuSession();
    assert.equal(drafts.menuGeneration, generationBefore + 1);
    assert.equal(drafts.menu, replacement);
});

test('reset re-clones all three drafts and ends the menu session', () => {
    // Baseline `resetNickelMenuState` 607-614: each draft is re-cloned from the
    // freshly defaulted session customization, and the menu session is bumped.
    const drafts = new CustomizationDrafts(session());
    const token = drafts.menuToken();
    const tabsBefore = drafts.tabs;
    const fontsBefore = drafts.fonts;

    const next = session();
    next.menuCustomization = { label: 'Renamed', icon: { type: 'default' } };
    drafts.reset(next);

    assert.equal(drafts.isCurrentMenu(token), false);
    assert.equal(drafts.menu.label, 'Renamed');
    assert.notEqual(drafts.menu, next.menuCustomization, 'the draft is a clone, not the selection object');
    assert.notEqual(drafts.tabs, tabsBefore);
    assert.notEqual(drafts.fonts, fontsBefore);
});
