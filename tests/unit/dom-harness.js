/**
 * dom-harness.js — Minimal jsdom DOM for unit-testing DOM-coupled shell modules.
 *
 * Import this module *before* the module under test. It installs the
 * window/document globals plus the wizard's step skeleton, so modules like
 * navigation.js and step-machine.js — which read the DOM at import time — can
 * be loaded and exercised under `node --test` without a browser.
 *
 * Not a test file (no `*.test.js` suffix), so the runner's glob skips it; it is
 * pulled in only by the specs that need a DOM.
 */

import { JSDOM } from 'jsdom';

// Every step <div> navigation.js looks up at module load, plus the generic
// flow-step ids the step-machine specs register their test flows against.
export const STEP_IDS = [
    'step-connect',
    'step-connect-instructions',
    'step-manual-version',
    'step-device',
    'step-mode',
    'step-nickelmenu',
    'step-nm-manual-remove',
    'step-nm-preset-conflict',
    'step-nm-features',
    'step-nm-backup',
    'step-nm-review',
    'step-nm-installing',
    'step-nm-done',
    'step-patches',
    'step-firmware',
    'step-building',
    'step-done',
    'step-error',
    'step-test-a',
    'step-test-b',
    'step-test-building',
    'step-test-done',
];

const stepDivs = STEP_IDS.map((id) => `<div id="${id}" hidden></div>`).join('');

// The patch editor dialog skeleton, matching the selectors patch-editor.js queries.
const editorDialog = `
<dialog id="patch-editor-dialog">
  <div class="modal-content">
    <div class="modal-header">
      <h2 class="patch-editor-title"></h2>
      <button type="button" class="modal-close patch-editor-cancel">Close</button>
    </div>
    <textarea class="patch-editor-textarea"></textarea>
    <p class="patch-editor-status"></p>
    <div class="modal-footer">
      <button type="button" class="patch-editor-validate">Validate</button>
      <button type="button" class="patch-editor-save">Save</button>
      <button type="button" class="patch-editor-cancel">Cancel</button>
    </div>
  </div>
</dialog>`;

const dom = new JSDOM(`<!doctype html><html><body><nav id="step-nav" hidden><ol></ol></nav>${stepDivs}${editorDialog}</body></html>`, {
    pretendToBeVisual: true,
});

// jsdom's <dialog> showModal/close are unreliable across versions; provide a
// minimal deterministic implementation so open state and the `close` event
// (which the editor relies on to reset its state) behave predictably.
const Dialog = dom.window.HTMLDialogElement;
if (Dialog) {
    Dialog.prototype.show = function show() {
        this.open = true;
    };
    Dialog.prototype.showModal = function showModal() {
        this.open = true;
    };
    Dialog.prototype.close = function close(returnValue) {
        if (returnValue !== undefined) this.returnValue = returnValue;
        this.open = false;
        this.dispatchEvent(new dom.window.Event('close'));
    };
}

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;

export { dom };
