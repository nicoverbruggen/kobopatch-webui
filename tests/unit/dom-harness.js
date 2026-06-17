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
    'step-connect', 'step-connect-instructions', 'step-manual-version', 'step-device',
    'step-mode', 'step-nickelmenu', 'step-nm-manual-remove', 'step-nm-preset-conflict', 'step-nm-features',
    'step-nm-backup', 'step-nm-review', 'step-nm-installing', 'step-nm-done',
    'step-patches', 'step-firmware', 'step-building', 'step-done', 'step-error',
    'step-test-a', 'step-test-b', 'step-test-building', 'step-test-done',
];

const stepDivs = STEP_IDS.map(id => `<div id="${id}" hidden></div>`).join('');
const dom = new JSDOM(
    `<!doctype html><html><body><nav id="step-nav" hidden><ol></ol></nav>${stepDivs}</body></html>`,
    { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;

export { dom };
