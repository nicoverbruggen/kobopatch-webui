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
 * Read only: `src/index.html` is never written (CONVENTIONS §4).
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
// of STEP_IDS comes from the real markup, so only these have to be synthesized.
const SYNTHETIC_STEP_IDS = STEP_IDS.filter((id) => id.startsWith('step-test-'));
const syntheticStepDivs = SYNTHETIC_STEP_IDS.map((id) => `<div id="${id}" hidden></div>`).join('');

// `src/index.html` with its step partials expanded. Every id and every element
// relationship matches the shipped page; the build additionally substitutes the
// commit hash, the `#commit-link` href and the critical-CSS placeholder, none of
// which affects a lookup by id. Step classes look their elements up in their
// constructors and throw when one is missing, so a stub skeleton cannot host
// them — and building from the real markup means deleting an id from a partial
// now breaks a unit test instead of only an E2E run.
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
// Must come from this window, not from Node. jsdom's `addEventListener` checks
// the signal against its own `AbortSignal` class and rejects Node's with
// "member 'signal' that is not of type 'AbortSignal'", which reads like a typo
// rather than a realm mismatch.
globalThis.AbortController = dom.window.AbortController;
// Same realm problem, different symptom: code that builds a synthetic event with
// `new Event('change')` — the mode screen and the NickelMenu config step both do,
// to make `setupCardRadios` apply the selected-card class — hands jsdom a Node
// `Event`, which it rejects with "parameter 1 is not of type 'Event'".
globalThis.Event = dom.window.Event;

export { dom };
