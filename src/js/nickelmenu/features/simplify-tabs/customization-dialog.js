/**
 * customization-dialog.js — the "Customize simplified tabs" dialog.
 *
 * Lets the user choose which optional bottom-nav tabs are shown and edit the
 * Books / Stats / Notes tab labels. Mirrors nickelmenu/customization-dialog.js
 * (the icon/label dialog) but is simpler — no image handling. The data model
 * lives alongside in ./customization.js; the localized default labels come from
 * ./index.js.
 */

import { $, trapFocus } from '../../../shell/dom.js';
import {
    createDefaultTabsCustomization,
    cloneTabsCustomization,
    sanitizeTabLabel,
    resolveTabVisibility,
    isDefaultTabsCustomization,
    visibleTabCount,
    TAB_LABEL_KEYS,
    TAB_VISIBILITY_KEYS,
} from './customization.js';
import { tabLabelsFor } from './index.js';

// A minimal bottom-navigation glyph for the summary chip. Uses currentColor so
// it follows the chip's text colour in both light and dark themes.
const TABS_SUMMARY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/><path d="M9 15v5"/><path d="M15 15v5"/></svg>';

const svgIcon = (inner) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner +
    '</svg>';

// The six bottom-navigation tabs, in device order, for the live preview. Home,
// Books and More are always shown; Stats/Notes/store follow the visibility
// toggles. Home/Discover/More carry a fixed preview name (they have no editable
// label); Books/Stats/Notes fall back to their default label when left blank.
const PREVIEW_TABS = [
    { key: 'home', always: true, fixedLabel: 'Home', icon: svgIcon('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>') },
    { key: 'books', always: true, icon: svgIcon('<path d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1Z"/><path d="M6 17h12"/>') },
    { key: 'stats', visKey: 'stats', icon: svgIcon('<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M3 20h18"/>') },
    { key: 'notes', visKey: 'notes', icon: svgIcon('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M10 3v18"/>') },
    { key: 'store', visKey: 'store', fixedLabel: 'Discover', icon: svgIcon('<path d="M6.5 8h11l-1 12h-9Z"/><path d="M9 8a3 3 0 0 1 6 0"/>') },
    {
        key: 'more',
        always: true,
        fixedLabel: 'More',
        icon: svgIcon(
            '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
        ),
    },
];

/**
 * The labels to seed the dialog's inputs with: the user's saved labels when
 * present, otherwise the device locale's default labels (empty for a locale we
 * don't translate, so the fields start blank and keep the device's own names).
 */
function seedLabels(state, customization) {
    if (customization.labels) return { ...customization.labels };
    const auto = tabLabelsFor(state.device?.deviceInfo?.uiLocale);
    return auto ? { ...auto } : { books: '', stats: '', notes: '' };
}

// The name shown for a tab in the preview: its fixed name, else the user's
// (non-empty) label, else the seeded default label, else the capitalized key.
function previewLabel(tab, draft, seed) {
    if (tab.fixedLabel) return tab.fixedLabel;
    const custom = (draft.labels?.[tab.key] || '').trim();
    if (custom) return custom;
    const fallback = (seed?.[tab.key] || '').trim();
    if (fallback) return fallback;
    return tab.key.charAt(0).toUpperCase() + tab.key.slice(1);
}

/** Render the approximate bottom-navigation bar for the current draft. */
export function renderTabsPreview(dialogDom, draft) {
    const preview = dialogDom.preview;
    if (!preview) return;
    const seed = dialogDom._seedLabels || {};
    const visibility = resolveTabVisibility(draft);
    preview.innerHTML = '';
    for (const tab of PREVIEW_TABS) {
        if (!tab.always && !visibility[tab.visKey]) continue;
        const item = document.createElement('span');
        item.className = 'nm-tabs-preview-tab';
        const icon = document.createElement('span');
        icon.className = 'nm-tabs-preview-icon';
        icon.innerHTML = tab.icon;
        const label = document.createElement('span');
        label.className = 'nm-tabs-preview-label';
        label.textContent = previewLabel(tab, draft, seed);
        item.append(icon, label);
        preview.appendChild(item);
    }
}

/**
 * Read the current dialog inputs back into the draft. Labels are sanitized live
 * (illegal characters stripped as the user types); visibility comes from the
 * checkboxes. Refreshes the live preview.
 */
export function updateTabsCustomizationDialog(draft, dialogDom) {
    const labels = {};
    for (const key of TAB_LABEL_KEYS) {
        const input = dialogDom.labels[key];
        const clean = sanitizeTabLabel(input.value);
        if (clean !== input.value) input.value = clean;
        labels[key] = clean;
    }
    draft.labels = labels;

    const visibility = {};
    for (const key of TAB_VISIBILITY_KEYS) {
        visibility[key] = dialogDom.visibility[key].checked;
    }
    draft.visibility = visibility;

    renderTabsPreview(dialogDom, draft);
}

/**
 * Fill the dialog inputs from a customization and return a matching draft. Used
 * both when opening the dialog and when the user hits "Reset defaults" (which
 * must not call showModal() again on the already-open dialog).
 */
export function seedTabsCustomizeDialog(state, dialogDom, customization) {
    const draft = cloneTabsCustomization(customization);
    const seed = seedLabels(state, draft);
    // Remember the default labels so blank inputs preview the device's own name.
    dialogDom._seedLabels = seed;
    for (const key of TAB_LABEL_KEYS) {
        dialogDom.labels[key].value = sanitizeTabLabel(seed[key]);
    }
    const visibility = resolveTabVisibility(draft);
    for (const key of TAB_VISIBILITY_KEYS) {
        dialogDom.visibility[key].checked = visibility[key];
    }
    renderTabsPreview(dialogDom, draft);
    return draft;
}

export function openTabsCustomizeDialog(state, dialogDom, triggerEl) {
    const draft = seedTabsCustomizeDialog(state, dialogDom, state.nickelMenuTabsCustomization);
    dialogDom.status.textContent = '';
    dialogDom._triggerEl = triggerEl;
    dialogDom.dialog.showModal();
    dialogDom.visibility.stats.focus();
    return draft;
}

export function getTabsCustomizationSummary(customization) {
    return {
        count: visibleTabCount(customization),
        iconHtml: TABS_SUMMARY_ICON,
    };
}

export function getTabsCustomizationSummaryItem(state) {
    const summary = getTabsCustomizationSummary(state.nickelMenuTabsCustomization);
    return {
        summaryId: 'nm-simplify-tabs-summary',
        summaryLabel: `${summary.count} tabs`,
        summaryIconHtml: summary.iconHtml,
    };
}

export function updateTabsCustomizationSummary(state) {
    const container = $('nm-simplify-tabs-summary');
    if (!container) return;
    const summary = getTabsCustomizationSummary(state.nickelMenuTabsCustomization);
    const icon = container.querySelector('.nm-config-summary-icon');
    const label = container.querySelector('.nm-config-summary-label');
    if (icon) icon.innerHTML = summary.iconHtml;
    if (label) label.textContent = `${summary.count} tabs`;
}

export { createDefaultTabsCustomization, cloneTabsCustomization, isDefaultTabsCustomization };

const _focusReturnWiredDialogs = new Set();
function wireFocusReturn(dlg) {
    if (_focusReturnWiredDialogs.has(dlg)) return;
    _focusReturnWiredDialogs.add(dlg);
    dlg.addEventListener('close', () => {
        const trigger = dlg._triggerEl;
        if (trigger && typeof trigger.focus === 'function') {
            trigger.focus({ preventScroll: true });
        }
    });
}

function wireDialog() {
    const dlg = $('nm-tabs-dialog');
    if (dlg) {
        wireFocusReturn(dlg);
        trapFocus(dlg);
    }
}

// Wire focus management when the DOM is ready (mirrors the icon dialog).
document.addEventListener('DOMContentLoaded', wireDialog, { once: true });
if (document.readyState !== 'loading') wireDialog();
