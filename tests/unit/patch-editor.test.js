import './dom-harness.js'; // installs document/window + the #patch-editor-dialog skeleton
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openPatchEditor, validatePatchEdit } from '../../src/js/patches/PatchEditor.js';
import { PatchUI } from '../../src/js/patches/PatchUI.js';
import { parsePatchYAML } from '../../src/js/patches/PatchYAML.js';

const FILE = 'src/nickel.yaml';
const RAW = 'Alpha:\n  - Enabled: yes\n  - FindReplaceString: a\nBeta:\n  - Enabled: no\n';

// The editor binds its save handler once, closing over the first PatchUI it
// sees — exactly like the app's single long-lived instance. Mirror that with
// one shared `ui` whose contents are reset before each test.
const ui = new PatchUI();

beforeEach(() => {
    const parsed = parsePatchYAML(RAW);
    ui.patchFiles = { [FILE]: { raw: RAW, patches: parsed } };
    ui.pristineText = { [FILE]: {} };
    ui.modifiedPatches = {};
    for (const p of parsed) {
        ui.pristineText[FILE][p.name] = ui._patchText(RAW, p.lineStart, p.lineEnd);
    }
});

function patchNamed(name) {
    return ui.patchFiles[FILE].patches.find((p) => p.name === name);
}

function makeStatusEls() {
    return { textarea: document.createElement('textarea'), statusEl: document.createElement('p') };
}

const dialog = () => document.getElementById('patch-editor-dialog');
const editorTextarea = () => dialog().querySelector('.patch-editor-textarea');
const editorStatus = () => dialog().querySelector('.patch-editor-status');
// Scoped to the footer, which is where patch-editor.js binds its click delegate.
// The header's close "x" also carries `patch-editor-cancel` but sits outside the
// footer, so an unscoped query would return a button the handler never sees.
const footerButton = (cls) => dialog().querySelector(`.modal-footer .${cls}`);

test('validatePatchEdit accepts a well-formed single-patch mapping', () => {
    const { textarea, statusEl } = makeStatusEls();
    textarea.value = 'Patch X:\n  - Enabled: yes\n  - FindReplaceString: foo\n';
    assert.equal(validatePatchEdit(textarea, statusEl), true);
    assert.match(statusEl.textContent, /^Valid/);
    assert.ok(statusEl.className.includes('patch-editor-status--ok'));
});

test('validatePatchEdit rejects empty, malformed, and structurally wrong input', () => {
    const { textarea, statusEl } = makeStatusEls();

    const expectError = (value, pattern) => {
        textarea.value = value;
        assert.equal(validatePatchEdit(textarea, statusEl), false, `expected invalid: ${value}`);
        assert.match(statusEl.textContent, pattern);
        assert.ok(statusEl.className.includes('patch-editor-status--error'));
    };

    expectError('', /cannot be empty/);
    expectError('Patch:\n  - : : :', /YAML error/);
    expectError('First:\n  - Enabled: yes\nSecond:\n  - Enabled: no\n', /Multiple root keys/);
    expectError('Patch:\n  Enabled: yes\n', /must be an array/);
    expectError('Patch:\n  - Enabled: maybe\n', /Enabled must be "yes" or "no"/);
});

test('validatePatchEdit warns on an unknown operation (in any item) but still allows saving', () => {
    const { textarea, statusEl } = makeStatusEls();
    // The unknown op is the second item — the scan must not stop at the first.
    textarea.value = 'Patch:\n  - Enabled: yes\n  - MadeUpOp: 1\n';
    assert.equal(validatePatchEdit(textarea, statusEl), true);
    assert.match(statusEl.textContent, /Unknown operation "MadeUpOp"/);
    assert.ok(statusEl.className.includes('patch-editor-status--warning'));
});

test('openPatchEditor fills the dialog with the patch block and opens it', () => {
    openPatchEditor(ui, patchNamed('Alpha'), FILE, document.createElement('div'));

    assert.equal(dialog().open, true);
    assert.equal(dialog().querySelector('.patch-editor-title').textContent, 'Edit: Alpha');
    assert.equal(editorTextarea().value, 'Alpha:\n  - Enabled: yes\n  - FindReplaceString: a');
    assert.equal(editorStatus().textContent, '');
    dialog().close();
});

test('saving a valid edit applies it to the model and closes the dialog', () => {
    openPatchEditor(ui, patchNamed('Alpha'), FILE, document.createElement('div'));

    editorTextarea().value = 'Alpha:\n  - Enabled: yes\n  - FindReplaceString: CHANGED\n';
    footerButton('patch-editor-save').click();

    assert.match(ui.patchFiles[FILE].raw, /FindReplaceString: CHANGED/);
    assert.equal(ui.isModified(FILE, 'Alpha'), true);
    assert.equal(dialog().open, false);
});

test('saving an invalid edit keeps the dialog open and does not touch the model', () => {
    openPatchEditor(ui, patchNamed('Alpha'), FILE, document.createElement('div'));

    editorTextarea().value = '';
    footerButton('patch-editor-save').click();

    assert.equal(dialog().open, true);
    assert.equal(ui.patchFiles[FILE].raw, RAW);
    assert.equal(ui.isModified(FILE, 'Alpha'), false);
    dialog().close();
});

test('the Validate button reports status without closing or applying', () => {
    openPatchEditor(ui, patchNamed('Alpha'), FILE, document.createElement('div'));

    editorTextarea().value = 'Alpha:\n  - Enabled: yes\n';
    footerButton('patch-editor-validate').click();

    assert.match(editorStatus().textContent, /^Valid/);
    assert.equal(dialog().open, true);
    assert.equal(ui.patchFiles[FILE].raw, RAW);
    dialog().close();
});

test('Cancel closes the dialog without applying changes', () => {
    openPatchEditor(ui, patchNamed('Alpha'), FILE, document.createElement('div'));

    editorTextarea().value = 'Alpha:\n  - Enabled: no\n';
    footerButton('patch-editor-cancel').click();

    assert.equal(dialog().open, false);
    assert.equal(ui.patchFiles[FILE].raw, RAW);
    assert.equal(ui.isModified(FILE, 'Alpha'), false);
});
