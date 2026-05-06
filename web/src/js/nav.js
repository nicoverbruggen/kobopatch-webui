/**
 * nav.js — Step navigation and progress bar.
 *
 * The app is a single-page wizard with many "step" <div>s, only one visible
 * at a time. This module manages:
 *   - Showing/hiding steps (with history tracking for back-navigation)
 *   - Rendering and updating the top progress bar (<nav> breadcrumb)
 *   - Card-style radio button interactivity (visual selection state)
 */

import { $, $q, $qa } from './dom.js';
import { TL } from './strings.js';

const stepNav = $('step-nav');

// Every step <div> in the app, in DOM order.
// Used by showStep() to hide all steps except the active one.
const allSteps = [
    $('step-connect'), $('step-connect-instructions'), $('step-manual-version'), $('step-device'),
    $('step-mode'), $('step-nickelmenu'), $('step-nm-preset-conflict'), $('step-nm-features'),
    $('step-nm-backup'), $('step-nm-review'), $('step-nm-installing'), $('step-nm-done'),
    $('step-patches'), $('step-firmware'), $('step-building'), $('step-done'),
    $('step-error'),
];

let currentNavLabels = TL.NAV_DEFAULT; // eslint-disable-line no-unused-vars -- kept for debuggability; tracks which label set is active

// Tracks the order of visited steps so "Back" buttons can unwind correctly.
// Starts with stepConnect since that's always the first screen shown.
export const stepHistory = [allSteps[0]];

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
    for (const s of allSteps) {
        s.hidden = (s !== step);
    }
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
    currentNavLabels = labels;
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
 */
export function setupCardRadios(container, selectedClass, onChange) {
    const labels = $qa('label', container);
    for (const label of labels) {
        const radio = $q('input[type="radio"]', label);
        if (!radio) continue;
        radio.addEventListener('change', () => {
            for (const l of labels) {
                if ($q('input[type="radio"]', l)) l.classList.remove(selectedClass);
            }
            if (radio.checked) label.classList.add(selectedClass);
            if (onChange) onChange(radio);
        });
    }
}
