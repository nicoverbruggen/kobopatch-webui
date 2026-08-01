/**
 * Navigation.js — Step navigation and progress bar.
 *
 * The app is a single-page wizard with many "step" <div>s, only one visible
 * at a time. This module manages:
 *   - Showing/hiding steps (with history tracking for back-navigation)
 *   - Rendering and updating the top progress bar (<nav> breadcrumb)
 *   - Card-style radio button interactivity (visual selection state)
 */

import { $, $q, $qa } from './DOM.js';

const stepNav = $('step-nav');
const stepConnect = $('step-connect');

// Every step <div> in the app, in DOM order.
// Used by showStep() to hide all steps except the active one.
const allSteps = [
    stepConnect,
    $('step-connect-instructions'),
    $('step-manual-version'),
    $('step-device'),
    $('step-mode'),
    $('step-nickelmenu'),
    $('step-nm-manual-remove'),
    $('step-nm-preset-conflict'),
    $('step-nm-features'),
    $('step-nm-backup'),
    $('step-nm-review'),
    $('step-nm-installing'),
    $('step-nm-done'),
    $('step-patches'),
    $('step-firmware'),
    $('step-building'),
    $('step-done'),
    $('step-error'),
];

// Tracks the order of visited steps so "Back" buttons can unwind correctly.
// Starts with stepConnect since that's always the first screen shown.
//
// Module-private: the two things callers actually do with it — ask whether a step
// is in it, and unwind to a step — are the exported operations below, so the loop
// that mutates the stack lives next to the stack.
const stepHistory = [allSteps[0]];

/**
 * Whether `step` is somewhere in the back-stack.
 *
 * @param {HTMLElement} step
 * @returns {boolean}
 */
export function historyIncludes(step) {
    return stepHistory.includes(step);
}

/**
 * Unwind the back-stack until `step` is on top, dropping everything after it.
 *
 * `step` itself is **left on the stack** — this returns to it, it does not
 * remove it. Pops unconditionally once first (the entry being left, i.e. the
 * error screen), then until `step` is on top. Stops at an empty stack if `step`
 * was never visited.
 *
 * That first pop is baseline behavior kept verbatim, and it is only observable
 * when `step` is *already* on top — which the one caller cannot produce, because
 * `showError` shows the error step before Back can be pressed. Removing it would
 * be a no-op today; it stays because "no-op today" is not the same as correct.
 *
 * @param {HTMLElement} step
 */
export function unwindHistoryTo(step) {
    stepHistory.pop();
    while (stepHistory.length > 0 && stepHistory[stepHistory.length - 1] !== step) {
        stepHistory.pop();
    }
}

/** Reset the back-stack to the landing screen. For tests that need a known start. */
export function resetHistory() {
    stepHistory.length = 1;
}

/**
 * Hide every step element except `step`.
 *
 * The one owner of "which elements are steps". `showStep` uses it, and so does
 * the step machine — which used to keep a second copy of the same set, rebuilt
 * by accumulating every `domId` registered with `createFlow`. That copy existed
 * only because nobody owned the list.
 *
 * Deliberately does *not* focus and does *not* touch history: `flow.go` hides,
 * then runs `onEnter`, then focuses, and folding this into `showStep` there
 * would move focus ahead of `onEnter`.
 *
 * @param {HTMLElement} step - the one element to leave visible
 */
export function hideAllStepsExcept(step) {
    for (const s of allSteps) {
        s.hidden = s !== step;
    }
}

/**
 * Show a single step and hide all others.
 *
 * When `push` is true (default), the step is added to `stepHistory`.
 * If the step was already visited, history is rewound to that point
 * (so going "back" to a previous step trims forward history).
 * Pass `push = false` for transient screens like "Building..." that
 * shouldn't appear in back-navigation.
 */
export function showStep(step, push = true) {
    hideAllStepsExcept(step);
    // The landing screen hides the step nav until the user picks how to connect.
    if (step === stepConnect) hideNav();
    step.setAttribute('tabindex', '-1');
    step.focus({ preventScroll: true });
    if (!push) return;
    const idx = stepHistory.indexOf(step);
    if (idx >= 0) {
        stepHistory.length = idx + 1;
    } else {
        stepHistory.push(step);
    }
}

/**
 * Replace the progress bar labels.
 * Different flows have different label sets (e.g. NAV_PATCHES vs NAV_NICKELMENU).
 */
export function setNavLabels(labels) {
    const ol = $q('ol', stepNav);
    ol.innerHTML = '';
    for (const label of labels) {
        const li = document.createElement('li');
        li.textContent = label;
        ol.appendChild(li);
    }
}

/**
 * Highlight the current step in the progress bar.
 * Steps before `num` get "done", step `num` gets "active" with aria-current.
 */
export function setNavStep(num) {
    const items = $qa('li', stepNav);
    items.forEach((li, i) => {
        const stepNum = i + 1;
        li.classList.remove('active', 'done');
        li.removeAttribute('aria-current');
        if (stepNum < num) li.classList.add('done');
        else if (stepNum === num) {
            li.classList.add('active');
            li.setAttribute('aria-current', 'step');
        }
    });
    stepNav.hidden = false;
}

export function hideNav() {
    stepNav.hidden = true;
}

export function showNav() {
    stepNav.hidden = false;
}

/**
 * Wire up card-style radio buttons so the selected card gets a CSS class.
 * Used for the mode selection cards and NickelMenu option cards.
 * When a radio inside a <label> is checked, the label gets `selectedClass`;
 * all sibling labels lose it.
 *
 * @param {HTMLElement} container
 * @param {string} selectedClass
 * @param {?function} [onChange] - called with the radio that was checked
 * @param {{signal?: AbortSignal}} [options] - `signal` detaches these listeners,
 *   which a caller that may be constructed more than once needs.
 */
export function setupCardRadios(container, selectedClass, onChange, { signal } = {}) {
    const labels = $qa('label', container);
    for (const label of labels) {
        const radio = $q('input[type="radio"]', label);
        if (!radio) continue;
        radio.addEventListener(
            'change',
            () => {
                for (const l of labels) {
                    if ($q('input[type="radio"]', l)) l.classList.remove(selectedClass);
                }
                if (radio.checked) label.classList.add(selectedClass);
                if (onChange) onChange(radio);
            },
            { signal },
        );
    }
}
