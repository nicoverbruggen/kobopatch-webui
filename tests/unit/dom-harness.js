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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { expandIncludes } from '../../scripts/html-includes.mjs';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * Read `src/index.html` and expand its includes through the build's own
 * expander, so the harness document cannot drift from what the browser gets.
 */
function readIndexHtml() {
    return expandIncludes(readFileSync(join(srcDir, 'index.html'), 'utf-8'), join(srcDir, 'html'));
}

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

// The step ids the step-machine specs invent for their own test flows. The rest
// come from the real markup, so only these have to be synthesized.
const syntheticStepIds = STEP_IDS.filter((id) => id.startsWith('step-test-'));
const syntheticStepDivs = syntheticStepIds.map((id) => `<div id="${id}" hidden></div>`).join('');

// Use the same expanded markup the browser receives. Build-time substitutions
// such as critical CSS and the commit hash do not affect unit-test DOM lookups.
const dom = new JSDOM(readIndexHtml().replace('</body>', `${syntheticStepDivs}</body>`), {
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
// jsdom requires these objects to come from its own realm.
globalThis.AbortController = dom.window.AbortController;
globalThis.Event = dom.window.Event;

export { dom };
