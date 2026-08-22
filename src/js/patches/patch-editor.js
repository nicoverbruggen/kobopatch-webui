/**
 * patch-editor.js — The "edit patch values" modal dialog.
 *
 * Owns the YAML textarea editor: opening it for a patch, validating the edited
 * YAML, and wiring its footer buttons. The transient editing state lives here
 * (there is one dialog and one PatchUI instance); saving is delegated to the
 * model's `ui.applyEdit`. It does not own patch state itself.
 */

import yaml from 'js-yaml';
import { $, trapFocus } from '../shell/dom.js';
import { parsePatchYAML } from './patch-yaml.js';
import { getPatchMeta } from './patch-metadata.js';

/**
 * Populate the editor's customization tips from a patch's metadata. Tips are the
 * webui-owned replacement for the old tuning instructions that lived only as
 * YAML comments; they render where a user actually changes values.
 */
function renderEditorTips(dialog, patchName) {
    const tipsEl = dialog.querySelector('.patch-editor-tips');
    if (!tipsEl) return;
    tipsEl.innerHTML = '';
    const tips = getPatchMeta(patchName).tips;
    if (!tips || tips.length === 0) {
        tipsEl.hidden = true;
        return;
    }
    const heading = document.createElement('p');
    heading.className = 'patch-editor-tips-heading';
    heading.textContent = 'Customization tips';
    tipsEl.appendChild(heading);
    const list = document.createElement('ul');
    for (const tip of tips) {
        const li = document.createElement('li');
        li.textContent = tip;
        list.appendChild(li);
    }
    tipsEl.appendChild(list);
    tipsEl.hidden = false;
}

// One shared dialog, bound once; `editing` holds the patch currently open.
let editorBound = false;
let editing = null;

function getEditorDialog() {
    return $('patch-editor-dialog');
}

/**
 * Validate the editor's YAML. Reports errors/warnings into `statusEl` and
 * returns whether the content is safe to save. Pure: no PatchUI access.
 */
export function validatePatchEdit(textarea, statusEl) {
    const value = textarea.value.trim();
    if (!value) {
        statusEl.textContent = 'Error: Patch definition cannot be empty.';
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    // Use js-yaml to validate syntax and structure
    let doc;
    try {
        doc = yaml.load(value);
    } catch (err) {
        const msg = err.mark ? `Line ${err.mark.line + 1}, col ${err.mark.column + 1}: ${err.message}` : err.message;
        statusEl.textContent = `YAML error: ${msg}`;
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    // Must be a mapping (object) with exactly one key — the patch name
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
        statusEl.textContent = 'Error: Patch definition must be a mapping (key: value pairs).';
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    const keys = Object.keys(doc);
    if (keys.length === 0) {
        statusEl.textContent = 'Error: No patch name found. Must start with a name followed by a colon.';
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    if (keys.length > 1) {
        statusEl.textContent = `Error: Multiple root keys detected (${keys.join(', ')}). Edit one patch at a time.`;
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    const patchName = keys[0];
    const body = doc[patchName];

    // Body must be an array of operation items
    if (!Array.isArray(body)) {
        statusEl.textContent = 'Error: Patch body must be an array of items (indented lines starting with "-").';
        statusEl.className = 'patch-editor-status patch-editor-status--error';
        return false;
    }

    // Validate each item.
    // Source of truth for these keys is kobopatch's patchfile parser:
    // https://github.com/pgaskin/kobopatch/blob/master/patchfile/kobopatch/kobopatch.go
    // (the `PatchableFunc`/instruction set). Keep in sync when upstream adds ops;
    // an unrecognized key only produces a soft warning, never blocks saving.
    const knownOps = [
        'Enabled',
        'Description',
        'PatchGroup',
        'FindZlib',
        'ReplaceZlib',
        'ReplaceZlibGroup',
        'FindZlibHash',
        'FindReplaceString',
        'ReplaceBytes',
        'ReplaceFloat',
        'BaseAddress',
        'MustMatchLength',
    ];
    let unknownOp = null;
    for (const item of body) {
        if (typeof item !== 'object' || item === null) continue;
        unknownOp = Object.keys(item).find((key) => !knownOps.includes(key));
        if (unknownOp) break;
    }

    // Validate Enabled value (must be yes/no). A hard error takes precedence
    // over the soft unknown-op warning below.
    const enabledEntry = body.find((item) => item && typeof item === 'object' && 'Enabled' in item);
    if (enabledEntry) {
        const val = enabledEntry.Enabled;
        if (val !== 'yes' && val !== 'no') {
            statusEl.textContent = `Error: Enabled must be "yes" or "no", got "${String(val)}".`;
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }
    }

    // An unrecognized op is a non-blocking warning: it still saves, but the
    // warning must survive (rather than be overwritten by the "valid" message).
    if (unknownOp) {
        statusEl.textContent = `Warning: Unknown operation "${unknownOp}" in patch "${patchName}". Check for typos.`;
        statusEl.className = 'patch-editor-status patch-editor-status--warning';
        return true;
    }

    statusEl.textContent = `Valid — patch "${patchName}" ready.`;
    statusEl.className = 'patch-editor-status patch-editor-status--ok';
    return true;
}

/**
 * Wire up the editor dialog's buttons exactly once. The handlers read the
 * patch currently being edited from the module-level `editing`, so there are no
 * per-open listeners to leak or tear down.
 */
function ensureEditorBound(ui, dialog) {
    if (editorBound) return;
    editorBound = true;

    const textarea = dialog.querySelector('.patch-editor-textarea');
    const statusEl = dialog.querySelector('.patch-editor-status');
    // Delegate from the whole dialog content: both the footer's Cancel button
    // and the header's close button carry `patch-editor-cancel`.
    const content = dialog.querySelector('.modal-content');

    content.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !editing) return;

        if (btn.classList.contains('patch-editor-validate')) {
            validatePatchEdit(textarea, statusEl);
        } else if (btn.classList.contains('patch-editor-save')) {
            if (validatePatchEdit(textarea, statusEl)) {
                const { patch, filename, container, displayedEnabled } = editing;
                ui.applyEdit(patch, filename, textarea.value, container, displayedEnabled);
                dialog.close();
            }
        } else if (btn.classList.contains('patch-editor-cancel')) {
            dialog.close();
        }
    });

    trapFocus(dialog);

    // Clicking the backdrop (outside the content) dismisses the dialog.
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });

    dialog.addEventListener('close', () => {
        editing = null;
    });
}

export function openPatchEditor(ui, patch, filename, container) {
    const dialog = getEditorDialog();
    if (!dialog) return;
    ensureEditorBound(ui, dialog);

    const lines = ui.patchFiles[filename].raw.split('\n');
    const patchYaml = lines.slice(patch.lineStart, patch.lineEnd).join('\n');

    const titleEl = dialog.querySelector('.patch-editor-title');
    const textarea = dialog.querySelector('.patch-editor-textarea');
    const statusEl = dialog.querySelector('.patch-editor-status');

    titleEl.textContent = `Edit: ${patch.name}`;
    renderEditorTips(dialog, patch.name);
    textarea.value = patchYaml;
    statusEl.textContent = '';
    statusEl.className = 'patch-editor-status';

    // The Enabled value the editor opens with (from the file text). Used on
    // save to tell a deliberate edit of the Enabled line from a no-op, so a
    // live checkbox/radio toggle isn't silently overwritten by the file's
    // default when the user only edited other fields.
    const displayedEnabled = parsePatchYAML(patchYaml)[0]?.enabled;

    editing = { patch, filename, container, displayedEnabled };

    dialog.showModal();
    textarea.focus();
}
