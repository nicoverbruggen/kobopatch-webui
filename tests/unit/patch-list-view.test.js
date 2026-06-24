import './dom-harness.js'; // installs document/window the renderer needs
import test from 'node:test';
import assert from 'node:assert/strict';

import { PatchUI } from '../../src/js/patches/ui.js';
import { PATCH_FILE_LABELS } from '../../src/js/patches/patch-yaml.js';

const FILE = 'src/nickel.yaml';

// Build a PatchUI with hand-made patch records (rendering only reads
// name/enabled/description/patchGroup — line ranges are for the editor).
function makeUI() {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.blacklist = { 4.45: { [FILE]: ['Risky patch'] } };
    ui.patchFiles = {
        [FILE]: {
            raw: '',
            patches: [
                {
                    name: 'Enabled standalone',
                    enabled: true,
                    description: '',
                    patchGroup: null,
                    lineStart: 0,
                    lineEnd: 1,
                },
                {
                    name: 'Disabled standalone',
                    enabled: false,
                    description: 'Some description here',
                    patchGroup: null,
                    lineStart: 1,
                    lineEnd: 2,
                },
                { name: 'Risky patch', enabled: false, description: '', patchGroup: null, lineStart: 2, lineEnd: 3 },
                { name: 'Font A', enabled: true, description: '', patchGroup: 'Fonts', lineStart: 3, lineEnd: 4 },
                { name: 'Font B', enabled: false, description: '', patchGroup: 'Fonts', lineStart: 4, lineEnd: 5 },
            ],
        },
    };
    return ui;
}

function container() {
    return document.createElement('div');
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

test('renders a section per file with the friendly label and enabled count', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const sections = el.querySelectorAll('.patch-file-section');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].dataset.filename, FILE);
    assert.equal(sections[0].querySelector('.patch-file-name').textContent, PATCH_FILE_LABELS[FILE]);
    // 2 enabled (Enabled standalone + Font A) of 5 total.
    assert.equal(sections[0].querySelector('.patch-count').textContent, '2 / 5 enabled');
});

test('renders standalone patches as checkboxes and grouped patches as radios', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const standalone = itemByName(el, 'Enabled standalone').querySelector('input');
    assert.equal(standalone.type, 'checkbox');
    assert.equal(standalone.checked, true);

    const group = el.querySelector('.patch-group');
    assert.ok(group);
    assert.equal(group.querySelector('.patch-group-label').textContent, 'Fonts');

    const fontA = itemByName(group, 'Font A').querySelector('input');
    const fontB = itemByName(group, 'Font B').querySelector('input');
    assert.equal(fontA.type, 'radio');
    assert.equal(fontA.checked, true);
    assert.equal(fontB.checked, false);
    // "None" is unchecked because a group member is enabled.
    const none = group.querySelector('.patch-name-none').closest('.patch-item').querySelector('input');
    assert.equal(none.checked, false);
});

test('marks blacklisted patches with a "known to fail" badge and disabled styling', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const risky = itemByName(el, 'Risky patch');
    assert.ok(risky.classList.contains('patch-disabled'));
    assert.equal(risky.querySelector('.patch-incompatible').textContent, 'known to fail');
});

test('view blacklist button opens a dialog scoped to the current firmware', () => {
    const previousUpdated = globalThis.__PATCH_BLACKLIST_UPDATED__;
    globalThis.__PATCH_BLACKLIST_UPDATED__ = '2026-06-20T10:37:15.000Z';
    const dialog = installBlacklistDialog();
    const ui = makeUI();
    ui.testedFirmwareVersion = '4.45.23697';
    const el = container();

    try {
        ui.render(el);
        el.querySelector('.patch-blacklist-button').click();

        assert.equal(dialog.open, true);
        assert.equal(el.querySelector('.patch-blacklist-button').textContent, 'Incompatible patches');
        assert.match(document.getElementById('patch-blacklist-description').textContent, /firmware 4\.45\.23697/);
        assert.match(document.getElementById('patch-blacklist-description').textContent, /Patch compatibility may vary/);
        assert.equal(document.getElementById('patch-blacklist-current-version').textContent, 'Your firmware version: 4.45.23646');
        assert.equal(document.getElementById('patch-blacklist-updated').textContent, 'Last updated: 2026-06-20');
        assert.equal(document.getElementById('patch-blacklist-empty').hidden, true);
        assert.equal(document.querySelector('.device-identification-badge--verified'), null);
        assert.equal(document.querySelector('.patch-blacklist-group h3').textContent, PATCH_FILE_LABELS[FILE]);

        assert.deepEqual(
            [...document.querySelectorAll('#patch-blacklist-list li')].map((item) => item.textContent),
            ['Risky patch'],
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
        el.querySelector('.patch-blacklist-button').click();

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
    ui.modifiedPatches = { [FILE]: new Set(['Enabled standalone']) };
    const el = container();
    ui.render(el);

    assert.ok(itemByName(el, 'Enabled standalone').querySelector('.patch-modified'));
    assert.equal(itemByName(el, 'Disabled standalone').querySelector('.patch-modified'), null);
});

test('description toggle reveals and hides the patch description', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const item = itemByName(el, 'Disabled standalone');
    const desc = item.querySelector('.patch-description');
    const toggle = item.querySelector('.patch-desc-toggle');
    assert.equal(desc.hidden, true);

    toggle.click();
    assert.equal(desc.hidden, false);
    toggle.click();
    assert.equal(desc.hidden, true);
});

test('toggling a checkbox updates the model, the count, and fires onChange', () => {
    const ui = makeUI();
    const el = container();
    let changes = 0;
    ui.onChange = () => {
        changes++;
    };
    ui.render(el);

    const input = itemByName(el, 'Disabled standalone').querySelector('input');
    input.checked = true;
    fireChange(input);

    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === 'Disabled standalone').enabled, true);
    assert.equal(el.querySelector('.patch-count').textContent, '3 / 5 enabled');
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

    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === 'Font A').enabled, false);
    assert.equal(ui.patchFiles[FILE].patches.find((p) => p.name === 'Font B').enabled, false);
    // Only "Enabled standalone" remains enabled.
    assert.equal(el.querySelector('.patch-count').textContent, '1 / 5 enabled');
});

test('search filters items by name and shows the empty-state when nothing matches', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const search = el.querySelector('.patch-search');
    const none = el.querySelector('.patch-search-none');

    // Matching query hides non-matching standalone items, keeps the group.
    search.value = 'Font';
    search.dispatchEvent(new window.Event('input'));
    assert.ok(itemByName(el, 'Enabled standalone').classList.contains('patch-item-hidden'));
    assert.ok(!itemByName(el.querySelector('.patch-group'), 'Font A').classList.contains('patch-item-hidden'));
    assert.equal(none.hidden, true);

    // No matches → empty-state visible.
    search.value = 'zzzzz';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(none.hidden, false);

    // Clearing restores everything.
    const clear = el.querySelector('.patch-search-clear');
    clear.click();
    assert.ok(!itemByName(el, 'Enabled standalone').classList.contains('patch-item-hidden'));
    assert.equal(none.hidden, true);
});

test('search query and saved open state reset when rendering a different patch set', () => {
    const ui = makeUI();
    const el = container();
    ui.render(el);

    const section = el.querySelector('.patch-file-section');
    section.open = false;
    const search = el.querySelector('.patch-search');
    search.value = 'Font';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(section.open, true);

    const nextUi = new PatchUI();
    nextUi.firmwareVersion = '4.46.99999';
    nextUi.patchFiles = {
        'src/other.yaml': {
            raw: '',
            patches: [{ name: 'Other patch', enabled: false, description: '', patchGroup: null, lineStart: 0, lineEnd: 1 }],
        },
    };

    nextUi.render(el);

    assert.equal(el.querySelector('.patch-search').value, '');
    assert.equal(el.querySelector('.patch-search-none').hidden, true);
    assert.equal(el.querySelector('.patch-file-section').open, false);
});
