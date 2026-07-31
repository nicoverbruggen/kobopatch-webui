import './dom-harness.js'; // the dialogs look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { CustomizationDialogs } from '../../src/js/flows/nickelmenu/CustomizationDialogs.js';
import { CustomizationDrafts } from '../../src/js/flows/nickelmenu/CustomizationDrafts.js';
import { NickelMenuSelection } from '../../src/js/flows/nickelmenu/NickelMenuSelection.js';
import { NM_MENU_DEFAULT_LABEL } from '../../src/js/nickelmenu/customization.js';

// The three subclasses, through the registry that owns them. What is worth
// pinning here is the per-feature behavior the base deliberately does not know
// about: which saves are refused, how tabs seeds its labels, and the fact that
// the three `adoptPrevious` gates are genuinely different from each other.

function makeRegistry(t, { uiLocale = undefined } = {}) {
    const selection = new NickelMenuSelection();
    const drafts = new CustomizationDrafts(selection);
    const listeners = new AbortController();
    t.after(() => listeners.abort());
    const session = { device: { deviceInfo: { uiLocale } } };
    const dialogs = new CustomizationDialogs(session, selection, drafts, listeners.signal);
    return { dialogs, selection, drafts, session };
}

const trigger = () => document.getElementById('btn-nm-next');

test('the registry keys every dialog by the type its feature declares', (t) => {
    const { dialogs } = makeRegistry(t);

    assert.deepEqual([...dialogs.byType.keys()], ['menu', 'tabs', 'fonts']);
    for (const [type, dialog] of dialogs.byType) {
        assert.equal(dialog.type, type, "the key is the dialog's own type, not a hand-written string");
    }
});

test("opening by type seeds and shows that feature's dialog", (t) => {
    const { dialogs } = makeRegistry(t);

    dialogs.open('tabs', trigger());

    assert.equal(dialogs.byType.get('tabs').dialog.open, true);
    assert.equal(dialogs.byType.get('menu').dialog.open, false);
    dialogs.byType.get('tabs').close();
});

test('an unknown type opens nothing rather than falling through to the menu', (t) => {
    // The bug this phase exists to remove: before `custom-menu` declared a type,
    // every dispatch ended `else -> menu`, so an unrecognised value opened the
    // menu dialog.
    const { dialogs } = makeRegistry(t);

    dialogs.open('does-not-exist', trigger());

    for (const dialog of dialogs.all()) {
        assert.equal(dialog.dialog.open, false, `${dialog.type} must stay closed`);
    }
    assert.deepEqual(dialogs.summaryItem('does-not-exist'), {});
});

test('the menu dialog refuses to save an invalid label', (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const menu = dialogs.byType.get('menu');
    const before = selection.menuCustomization;

    menu.open(trigger());
    menu.labelInput.value = '!!!'; // sanitizes to empty, which is not a valid label
    menu.save();

    assert.equal(selection.menuCustomization, before, 'nothing was committed');
    assert.equal(menu.dialog.open, true, 'the dialog stays open');
    assert.match(menu.status.textContent, /letters or numbers/);
    menu.close();
});

test('the menu dialog saves a sanitized label and repaints nothing it should not', (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const menu = dialogs.byType.get('menu');

    menu.open(trigger());
    menu.labelInput.value = 'My Menu!';
    menu.save();

    assert.equal(selection.menuCustomization.label, 'MyMenu', 'punctuation and spaces are stripped');
    assert.equal(menu.dialog.open, false);
});

test('the fonts dialog refuses to save an empty selection', (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const fonts = dialogs.byType.get('fonts');
    const before = selection.fontsCustomization;

    fonts.open(trigger());
    // Through the UI, the way a user empties it: "None" for both collections.
    fonts.btnCoreNone.dispatchEvent(new window.Event('click'));
    fonts.btnExtraNone.dispatchEvent(new window.Event('click'));
    fonts.save();

    assert.equal(selection.fontsCustomization, before, 'nothing was committed');
    assert.equal(fonts.dialog.open, true, 'the dialog stays open');
    assert.equal(fonts.status.textContent, 'Select at least one font family.');
    fonts.close();
});

test('the tabs dialog seeds its labels from the device locale', (t) => {
    const { dialogs } = makeRegistry(t, { uiLocale: 'fr-FR' });
    const tabs = dialogs.byType.get('tabs');

    tabs.open(trigger());

    assert.equal(tabs.labels.books.value, 'Livres');
    tabs.close();
});

test('the tabs dialog leaves labels blank for a language we do not translate', (t) => {
    // A known language with no table entry seeds empty, so the device keeps its
    // own names rather than being relabelled in English.
    const { dialogs } = makeRegistry(t, { uiLocale: 'ja' });
    const tabs = dialogs.byType.get('tabs');

    tabs.open(trigger());

    assert.equal(tabs.labels.books.value, '');
    tabs.close();
});

test('the tabs dialog falls back to English for an unknown locale', (t) => {
    // The manual/download flow has no device, so no locale.
    const { dialogs } = makeRegistry(t, { uiLocale: undefined });
    const tabs = dialogs.byType.get('tabs');

    tabs.open(trigger());

    assert.equal(tabs.labels.books.value, 'Books');
    tabs.close();
});

test('the locale is read when the dialog opens, not when it is constructed', (t) => {
    // The device connects long after `NickelMenuFlow` builds these, so a locale
    // captured at construction would always be the no-device fallback.
    const { dialogs, session } = makeRegistry(t, { uiLocale: undefined });
    const tabs = dialogs.byType.get('tabs');

    session.device.deviceInfo.uiLocale = 'de-DE';
    tabs.open(trigger());

    assert.equal(tabs.labels.books.value, 'Bücher');
    tabs.close();
});

test("reset restores this feature's defaults without touching the others", (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const menu = dialogs.byType.get('menu');

    menu.open(trigger());
    menu.labelInput.value = 'Custom';
    menu.save();
    assert.equal(selection.menuCustomization.label, 'Custom');

    menu.open(trigger());
    menu.reset();

    assert.equal(menu.labelInput.value, NM_MENU_DEFAULT_LABEL);
    assert.equal(menu.status.textContent, 'Defaults restored.', 'the committed value is not the default, so it says so');
    assert.equal(selection.menuCustomization.label, 'Custom', 'reset edits the draft, not the committed value');
    menu.close();
});

test('the menu reset ends the dialog session before installing the default draft', (t) => {
    // An upload still resolving must not write into the freshly reset draft.
    const { dialogs, drafts } = makeRegistry(t);
    const menu = dialogs.byType.get('menu');
    menu.open(trigger());
    const token = drafts.menuToken();

    menu.reset();

    assert.equal(drafts.isCurrentMenu(token), false);
    menu.close();
});

test('adoptPrevious gates differ per feature, and the menu has no feature-id gate', (t) => {
    // The asymmetry looks like an oversight until you notice the menu genuinely
    // restores whether or not `custom-menu` was among the selected ids.
    const { dialogs, selection } = makeRegistry(t);
    const previous = {
        menuCustomization: { label: 'Prev', icon: { type: 'default' } },
        tabsCustomization: { labels: { books: 'Prev', stats: '', notes: '' }, visibility: { stats: true, notes: false, store: false } },
        fontsCustomization: { families: ['readerly'] },
    };
    const tabsBefore = selection.tabsCustomization;
    const fontsBefore = selection.fontsCustomization;

    dialogs.adoptPrevious(previous, new Set());

    assert.equal(selection.menuCustomization.label, 'Prev', 'the menu adopts with no feature-id gate');
    assert.equal(selection.tabsCustomization, tabsBefore, 'tabs requires simplify-tabs to have been selected');
    assert.equal(selection.fontsCustomization, fontsBefore, 'fonts requires additional-fonts to have been selected');
});

test('adoptPrevious restores tabs and fonts once their feature ids are present', (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const previous = {
        tabsCustomization: { labels: { books: 'Prev', stats: '', notes: '' }, visibility: { stats: true, notes: false, store: false } },
        fontsCustomization: { families: ['readerly'] },
    };

    dialogs.adoptPrevious(previous, new Set(['simplify-tabs', 'additional-fonts']));

    assert.equal(selection.tabsCustomization.labels.books, 'Prev');
    assert.deepEqual(selection.fontsCustomization.families, ['readerly']);
});

test('a previous configuration carrying nothing for a feature leaves it alone', (t) => {
    const { dialogs, selection } = makeRegistry(t);
    const before = selection.menuCustomization;
    const tabsBefore = selection.tabsCustomization;

    dialogs.adoptPrevious({}, new Set(['simplify-tabs', 'additional-fonts']));

    assert.equal(selection.menuCustomization, before);
    assert.equal(selection.tabsCustomization, tabsBefore);
});

test('every summary chip carries its own container id', (t) => {
    const { dialogs } = makeRegistry(t);

    assert.equal(dialogs.summaryItem('menu').summaryId, 'nm-custom-menu-summary');
    assert.equal(dialogs.summaryItem('tabs').summaryId, 'nm-simplify-tabs-summary');
    assert.equal(dialogs.summaryItem('fonts').summaryId, 'nm-fonts-summary');
    assert.match(dialogs.summaryItem('tabs').summaryLabel, /^\d+ tabs$/);
    assert.match(dialogs.summaryItem('fonts').summaryLabel, /^\d+ fonts$/);
});
