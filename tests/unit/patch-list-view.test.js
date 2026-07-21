import './dom-harness.js'; // installs document/window the renderer needs
import test from 'node:test';
import assert from 'node:assert/strict';

import { PatchUI } from '../../src/js/patches/ui.js';
import { openBlacklistDialog } from '../../src/js/patches/patch-list-view.js';

const FILE = 'src/nickel.yaml';

// Real catalog patch names so the metadata layer (patch-metadata.js) buckets
// them into known categories. The renderer only reads name/enabled/description/
// patchGroup off these records — line ranges are for the editor.
const STANDALONE_TYPO = 'Custom font sizes'; // typography
const STANDALONE_INPUT = 'Disable menu swipe gesture'; // input
const BLACKLISTED_PDF = 'Remove PDF map widget shown during panning'; // pdf
const GROUP_A = 'My 10 line spacing values'; // typography, grouped
const GROUP_B = 'My 24 line spacing values'; // typography, same group
const GROUP_NAME = 'Line spacing values alternatives';

// Build a PatchUI with hand-made patch records spanning three categories.
function makeUI() {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.blacklist = { 4.45: { [FILE]: [BLACKLISTED_PDF] } };
    ui.patchFiles = {
        [FILE]: {
            raw: '',
            patches: [
                { name: STANDALONE_TYPO, enabled: true, description: '', patchGroup: null, lineStart: 0, lineEnd: 1 },
                { name: STANDALONE_INPUT, enabled: false, description: '', patchGroup: null, lineStart: 1, lineEnd: 2 },
                { name: BLACKLISTED_PDF, enabled: false, description: '', patchGroup: null, lineStart: 2, lineEnd: 3 },
                { name: GROUP_A, enabled: true, description: '', patchGroup: GROUP_NAME, lineStart: 3, lineEnd: 4 },
                { name: GROUP_B, enabled: false, description: '', patchGroup: GROUP_NAME, lineStart: 4, lineEnd: 5 },
            ],
        },
    };
    return ui;
}

function container() {
    return document.createElement('div');
}

function sectionByCategory(root, id) {
    return [...root.querySelectorAll('.patch-file-section')].find((s) => s.dataset.category === id);
}

function installBlacklistDialog() {
    const previous = document.getElementById('patch-blacklist-dialog');
    previous?.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'patch-blacklist-dialog';
    dialog.innerHTML = [
        '<div class="patch-blacklist-dialog-content">',
        '  <p id="patch-blacklist-updated"></p>',
        '  <p id="patch-blacklist-description"></p>',
        '  <p id="patch-blacklist-current-version"></p>',
        '  <p id="patch-blacklist-empty" hidden></p>',
        '  <div id="patch-blacklist-list"></div>',
        '  <div id="patch-blacklist-version-tooltip" hidden></div>',
        '  <button id="btn-patch-blacklist-close" type="button">Close</button>',
        '</div>',
    ].join('');
    document.body.appendChild(dialog);
    return dialog;
}

function itemByName(root, name) {
    return [...root.querySelectorAll('.patch-item')].find((el) => el.querySelector('.patch-name')?.textContent === name);
}

function fireChange(el) {
    el.dispatchEvent(new window.Event('change'));
}

test('renders one section per category in PATCH_CATEGORIES order with friendly labels and counts', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const sections = el.querySelectorAll('.patch-file-section');
    // typography, input, pdf — in declared category order.
    assert.deepEqual(
        [...sections].map((s) => s.dataset.category),
        ['typography', 'input', 'pdf'],
    );

    const typo = sectionByCategory(el, 'typography');
    assert.equal(typo.querySelector('.patch-file-name').textContent, 'Typography & Fonts');
    // The mutually-exclusive line-spacing group counts as ONE choice, so typography
    // has 2 selectable units (Custom font sizes + the group), both with a selection.
    assert.equal(typo.querySelector('.patch-count').textContent, '2 / 2 enabled');
});

test('original-format toggle groups by source file and shows raw YAML names', () => {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.patchFiles = {
        'src/nickel.yaml': {
            raw: '',
            patches: [{ name: 'Remove footer (row3) on new home screen', enabled: false, description: '', patchGroup: null, lineStart: 0, lineEnd: 1 }],
        },
    };
    const el = container();

    // Themed mode (default): themed section + the metadata display label.
    ui.render(el);
    assert.equal(el.querySelector('.patch-file-section').dataset.category, 'home');
    assert.ok(itemByName(el, 'Hide home-screen footer row'));

    // Original mode: grouped by source file, shown under the raw YAML name.
    el.dataset.originalFormat = 'true';
    ui.render(el);
    const section = el.querySelector('.patch-file-section');
    assert.equal(section.dataset.category, 'src/nickel.yaml');
    assert.equal(section.querySelector('.patch-file-name').textContent, 'Nickel (UI patches)');
    assert.ok(itemByName(el, 'Remove footer (row3) on new home screen'));
    assert.equal(itemByName(el, 'Hide home-screen footer row'), undefined);
});

test('renders standalone patches as checkboxes and grouped patches as radios', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const standalone = itemByName(el, STANDALONE_TYPO).querySelector('input');
    assert.equal(standalone.type, 'checkbox');
    assert.equal(standalone.checked, true);

    const group = el.querySelector('.patch-group');
    assert.ok(group);
    assert.equal(group.querySelector('.patch-group-label').textContent, GROUP_NAME);

    const a = itemByName(group, GROUP_A).querySelector('input');
    const b = itemByName(group, GROUP_B).querySelector('input');
    assert.equal(a.type, 'radio');
    assert.equal(a.checked, true);
    assert.equal(b.checked, false);
    // "None" is unchecked because a group member is enabled.
    const none = group.querySelector('.patch-name-none').closest('.patch-item').querySelector('input');
    assert.equal(none.checked, false);
});

test('marks blacklisted patches with a "known to fail" badge and disabled styling', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const risky = itemByName(el, BLACKLISTED_PDF);
    assert.ok(risky.classList.contains('patch-disabled'));
    assert.equal(risky.querySelector('.patch-incompatible').textContent, 'known to fail');
});

test('view blacklist button opens a dialog grouped by category', () => {
    const previousUpdated = globalThis.__PATCH_BLACKLIST_UPDATED__;
    globalThis.__PATCH_BLACKLIST_UPDATED__ = '2026-06-20T10:37:15.000Z';
    const dialog = installBlacklistDialog();
    const ui = makeUI();
    ui.testedFirmwareVersion = '4.45.23697';
    const el = container();

    try {
        ui.render(el);
        openBlacklistDialog(ui, el);

        assert.equal(dialog.open, true);
        assert.match(document.getElementById('patch-blacklist-description').textContent, /firmware 4\.45\.23697/);
        assert.match(document.getElementById('patch-blacklist-description').textContent, /Patch compatibility may vary/);
        assert.equal(document.getElementById('patch-blacklist-current-version').textContent, 'Your firmware version: 4.45.23646');
        assert.equal(document.getElementById('patch-blacklist-updated').textContent, 'Last updated: 2026-06-20');
        assert.equal(document.getElementById('patch-blacklist-empty').hidden, true);
        assert.equal(document.querySelector('.device-identification-badge--verified'), null);
        // The single blacklisted patch is a PDF patch, so the section label is the category label.
        assert.equal(document.querySelector('.patch-blacklist-group h3').textContent, 'PDF');

        assert.deepEqual(
            [...document.querySelectorAll('#patch-blacklist-list li')].map((item) => item.textContent),
            [BLACKLISTED_PDF],
        );
        assert.equal(dialog.textContent.includes(FILE), false);
    } finally {
        if (previousUpdated === undefined) delete globalThis.__PATCH_BLACKLIST_UPDATED__;
        else globalThis.__PATCH_BLACKLIST_UPDATED__ = previousUpdated;
        dialog.remove();
    }
});

test('view blacklist dialog marks an exact tested-firmware match', () => {
    const dialog = installBlacklistDialog();
    const ui = makeUI();
    ui.testedFirmwareVersion = '4.45.23646';
    const el = container();

    try {
        ui.render(el);
        openBlacklistDialog(ui, el);

        const match = document.querySelector('.device-identification-badge--verified');
        assert.ok(match);
        assert.equal(match.getAttribute('aria-describedby'), 'patch-blacklist-version-tooltip');
        match.dispatchEvent(new window.Event('mouseenter'));
        const tooltip = document.getElementById('patch-blacklist-version-tooltip');
        assert.equal(tooltip.hidden, false);
        assert.equal(tooltip.textContent, 'Your firmware version matches the version that was tested');
        assert.equal(tooltip.classList.contains('patch-blacklist-version-tooltip--visible'), true);
    } finally {
        dialog.remove();
    }
});

test('shows a modified badge only for user-edited patches', () => {
    const ui = makeUI();
    ui.modifiedPatches = { [FILE]: new Set([STANDALONE_TYPO]) };
    const el = container();
    ui.render(el);

    assert.ok(itemByName(el, STANDALONE_TYPO).querySelector('.patch-modified'));
    assert.equal(itemByName(el, STANDALONE_INPUT).querySelector('.patch-modified'), null);
});

test('description toggle reveals and hides the patch notes', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    // STANDALONE_INPUT has metadata prose, so it gets a notes panel and toggle.
    const item = itemByName(el, STANDALONE_INPUT);
    const notes = item.querySelector('.patch-notes');
    const toggle = item.querySelector('.patch-desc-toggle');
    assert.ok(notes);
    assert.ok(notes.querySelector('.patch-description'));
    assert.equal(notes.hidden, true);

    toggle.click();
    assert.equal(notes.hidden, false);
    toggle.click();
    assert.equal(notes.hidden, true);
});

test('toggling a checkbox updates the model, the category count, and fires onChange', () => {
    const ui = makeUI();
    const el = container();
    let changes = 0;
    ui.onChange = () => {
        changes++;
    };
    ui.render(el);

    const input = itemByName(el, STANDALONE_INPUT).querySelector('input');
    input.checked = true;
    fireChange(input);

    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === STANDALONE_INPUT).enabled, true);
    assert.equal(sectionByCategory(el, 'input').querySelector('.patch-count').textContent, '1 / 1 enabled');
    assert.equal(changes, 1);
});

test('selecting "None" in a group disables every member of that group', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const group = el.querySelector('.patch-group');
    const none = group.querySelector('.patch-name-none').closest('.patch-item').querySelector('input');
    none.checked = true;
    fireChange(none);

    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === GROUP_A).enabled, false);
    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === GROUP_B).enabled, false);
    // The group is now "none" (0 of its options chosen); only "Custom font sizes"
    // remains, so 1 of the 2 selectable units is enabled.
    assert.equal(sectionByCategory(el, 'typography').querySelector('.patch-count').textContent, '1 / 2 enabled');
});

test('search filters items by name and shows the empty-state when nothing matches', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const search = el.querySelector('.patch-search');
    const none = el.querySelector('.patch-search-none');

    // Matching query hides non-matching standalone items.
    search.value = 'menu swipe';
    search.dispatchEvent(new window.Event('input'));
    assert.ok(itemByName(el, STANDALONE_TYPO).classList.contains('patch-item-hidden'));
    assert.ok(!itemByName(el, STANDALONE_INPUT).classList.contains('patch-item-hidden'));
    assert.equal(none.hidden, true);

    // No matches → empty-state visible.
    search.value = 'zzzzz';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(none.hidden, false);

    // Clearing restores everything.
    const clear = el.querySelector('.patch-search-clear');
    clear.click();
    assert.ok(!itemByName(el, STANDALONE_TYPO).classList.contains('patch-item-hidden'));
    assert.equal(none.hidden, true);
});

test('search query and saved open state reset when rendering a different patch set', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const section = sectionByCategory(el, 'typography');
    section.open = false;
    const search = el.querySelector('.patch-search');
    search.value = 'Custom';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(section.open, true);

    const nextUi = new PatchUI();
    nextUi.firmwareVersion = '4.46.99999';
    nextUi.patchFiles = {
        'src/cloud_sync.yaml': {
            raw: '',
            patches: [
                {
                    name: 'Unlock Dropbox and Google Drive support',
                    enabled: false,
                    description: '',
                    patchGroup: null,
                    lineStart: 0,
                    lineEnd: 1,
                },
            ],
        },
    };

    nextUi.render(el);

    assert.equal(el.querySelector('.patch-search').value, '');
    assert.equal(el.querySelector('.patch-search-none').hidden, true);
    assert.equal(el.querySelector('.patch-file-section').open, false);
});
