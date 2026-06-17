/**
 * patch-editor.js — The "edit patch values" modal dialog.
 *
 * Owns the YAML textarea editor: opening it for a patch, validating the edited
 * YAML, and wiring its footer buttons. It reads/writes the editing state on the
 * PatchUI instance (`ui._editing`, `ui._editorBound`) and saves through the
 * model's `ui._saveEdit`; it does not own patch state itself.
 */

import yaml from 'js-yaml';
import { trapFocus } from '../shell/dom.js';
import { parsePatchYAML } from './patch-yaml.js';

function getEditorDialog() {
    return document.getElementById('patch-editor-dialog');
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
        const msg = err.mark
            ? `Line ${err.mark.line + 1}, col ${err.mark.column + 1}: ${err.message}`
            : err.message;
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
    const knownOps = ['Enabled', 'Description', 'PatchGroup', 'FindZlib', 'ReplaceZlib', 'ReplaceZlibGroup', 'FindZlibHash', 'FindReplaceString', 'ReplaceBytes', 'ReplaceFloat', 'BaseAddress', 'MustMatchLength'];
    for (const item of body) {
        if (typeof item !== 'object' || item === null) continue;
        for (const key of Object.keys(item)) {
            if (!knownOps.includes(key)) {
                statusEl.textContent = `Warning: Unknown operation "${key}" in patch "${patchName}". Check for typos.`;
                statusEl.className = 'patch-editor-status patch-editor-status--warning';
                break;
            }
        }
        // Only check first unknown key
        break;
    }

    // Validate Enabled value (must be yes/no)
    const enabledEntry = body.find(item => item && typeof item === 'object' && 'Enabled' in item);
    if (enabledEntry) {
        const val = enabledEntry.Enabled;
        if (val !== 'yes' && val !== 'no') {
            statusEl.textContent = `Error: Enabled must be "yes" or "no", got "${String(val)}".`;
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }
    }

    statusEl.textContent = `Valid — patch "${patchName}" ready.`;
    statusEl.className = 'patch-editor-status patch-editor-status--ok';
    return true;
}

/**
 * Wire up the editor dialog's buttons exactly once. The handlers read the
 * patch currently being edited from `ui._editing`, so there are no per-open
 * listeners to leak or tear down.
 */
function ensureEditorBound(ui, dialog) {
    if (ui._editorBound) return;
    ui._editorBound = true;

    const textarea = dialog.querySelector('.patch-editor-textarea');
    const statusEl = dialog.querySelector('.patch-editor-status');
    const footer = dialog.querySelector('.modal-footer');

    footer.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !ui._editing) return;

        if (btn.classList.contains('patch-editor-validate')) {
            validatePatchEdit(textarea, statusEl);
        } else if (btn.classList.contains('patch-editor-save')) {
            if (validatePatchEdit(textarea, statusEl)) {
                const { patch, filename, container } = ui._editing;
                ui._saveEdit(patch, filename, textarea.value, container);
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

    dialog.addEventListener('close', () => { ui._editing = null; });
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
    textarea.value = patchYaml;
    statusEl.textContent = '';
    statusEl.className = 'patch-editor-status';

    // The Enabled value the editor opens with (from the file text). Used on
    // save to tell a deliberate edit of the Enabled line from a no-op, so a
    // live checkbox/radio toggle isn't silently overwritten by the file's
    // default when the user only edited other fields.
    const displayedEnabled = parsePatchYAML(patchYaml)[0]?.enabled;

    ui._editing = { patch, filename, container, displayedEnabled };

    dialog.showModal();
    textarea.focus();
}
