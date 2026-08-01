/**
 * TabsCustomizationDialog.js — the "Customize simplified tabs" dialog.
 *
 * Lets the user choose which optional bottom-nav tabs are shown and edit the
 * Books / Stats / Notes labels, with a live preview of the resulting nav bar.
 * The data model lives alongside in ./customization.js and the localized default
 * labels come from ./index.js; everything specific to this feature's dialog is
 * here, and the mechanics come from `CustomizationDialog`.
 */

import { requireElement, requireInput } from '../../../shell/DOM.js';
import { CustomizationDialog } from '../../CustomizationDialog.js';
import {
    createDefaultTabsCustomization,
    cloneTabsCustomization,
    sanitizeTabLabel,
    resolveTabVisibility,
    visibleTabCount,
    TAB_LABEL_KEYS,
    TAB_VISIBILITY_KEYS,
} from './TabsCustomization.js';
import { defaultTabLabels } from './index.js';

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
    {
        key: 'books',
        always: true,
        icon: svgIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>'),
    },
    { key: 'stats', visKey: 'stats', icon: svgIcon('<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M3 20h18"/>') },
    { key: 'notes', visKey: 'notes', icon: svgIcon('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M10 3v18"/>') },
    {
        key: 'store',
        visKey: 'store',
        fixedLabel: 'Discover',
        icon: svgIcon('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
    },
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
 * present, otherwise the device locale's default labels — English for an unknown
 * locale (manual/download flow), and empty for a known language we don't
 * translate, so those fields start blank and keep the device's own names.
 */
function seedLabels(uiLocale, customization) {
    if (customization.labels) return { ...customization.labels };
    const auto = defaultTabLabels(uiLocale);
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

export class TabsCustomizationDialog extends CustomizationDialog {
    /**
     * @param {object} config
     * @param {import('../../../flows/nickelmenu/NickelMenuSelection.js').NickelMenuSelection} config.selection
     * @param {import('../../../flows/nickelmenu/CustomizationDrafts.js').CustomizationDrafts} config.drafts
     * @param {() => (string|undefined)} config.uiLocale - read lazily, because the
     *   device connects after this dialog is constructed
     * @param {AbortSignal} config.signal
     */
    constructor({ selection, drafts, uiLocale, signal }) {
        // `uiLocale` is picked up by `bindElements`, which the base calls from here.
        super({
            type: 'tabs',
            dialogId: 'nm-tabs-dialog',
            statusId: 'nm-tabs-status',
            closeId: 'btn-nm-tabs-close',
            cancelId: 'btn-nm-tabs-cancel',
            resetId: 'btn-nm-tabs-reset',
            saveId: 'btn-nm-tabs-save',
            summaryContainerId: 'nm-simplify-tabs-summary',
            selection,
            drafts,
            uiLocale,
            signal,
        });
    }

    bindElements({ uiLocale }) {
        this.uiLocale = uiLocale;
        this.preview = requireElement('nm-tabs-preview');
        this.visibility = {
            stats: requireInput('nm-tabs-vis-stats'),
            notes: requireInput('nm-tabs-vis-notes'),
            store: requireInput('nm-tabs-vis-store'),
        };
        this.labels = {
            books: requireInput('nm-tabs-label-books'),
            stats: requireInput('nm-tabs-label-stats'),
            notes: requireInput('nm-tabs-label-notes'),
        };
        /** The default labels behind blank inputs, so the preview shows the device's own names. */
        this.seededLabels = {};
    }

    get committed() {
        return this.selection.tabsCustomization;
    }

    set committed(value) {
        this.selection.tabsCustomization = value;
    }

    get draft() {
        return this.drafts.tabs;
    }

    set draft(value) {
        this.drafts.tabs = value;
    }

    createDefault() {
        return createDefaultTabsCustomization();
    }

    seed(customization) {
        const draft = cloneTabsCustomization(customization);
        const seed = seedLabels(this.uiLocale(), draft);
        this.seededLabels = seed;
        for (const key of TAB_LABEL_KEYS) {
            this.labels[key].value = sanitizeTabLabel(seed[key]);
        }
        const visibility = resolveTabVisibility(draft);
        for (const key of TAB_VISIBILITY_KEYS) {
            this.visibility[key].checked = visibility[key];
        }
        this.status.textContent = '';
        this.#renderPreview(draft);
        return draft;
    }

    focusInitial() {
        this.visibility.stats.focus();
    }

    commit() {
        this.#readInputs(this.draft);
        return {
            labels: { ...this.draft.labels },
            visibility: { ...this.draft.visibility },
        };
    }

    summary(customization) {
        return {
            label: `${visibleTabCount(customization)} tabs`,
            iconHtml: TABS_SUMMARY_ICON,
        };
    }

    /** Gated on the feature having been selected, unlike the menu dialog's. */
    adoptPrevious(previous, previousIds) {
        if (!previous?.tabsCustomization || !previousIds.has('simplify-tabs')) return;
        this.committed = cloneTabsCustomization(previous.tabsCustomization);
        this.draft = cloneTabsCustomization(this.committed);
    }

    wire(signal) {
        for (const input of [...Object.values(this.visibility), ...Object.values(this.labels)]) {
            input.addEventListener('input', () => this.#readInputs(this.draft), { signal });
        }
    }

    /**
     * Read the current inputs back into the draft. Labels are sanitized live
     * (illegal characters stripped as the user types); visibility comes from the
     * checkboxes. Refreshes the live preview.
     */
    #readInputs(draft) {
        const labels = {};
        for (const key of TAB_LABEL_KEYS) {
            const input = this.labels[key];
            const clean = sanitizeTabLabel(input.value);
            if (clean !== input.value) input.value = clean;
            labels[key] = clean;
        }
        draft.labels = labels;

        const visibility = {};
        for (const key of TAB_VISIBILITY_KEYS) {
            visibility[key] = this.visibility[key].checked;
        }
        draft.visibility = visibility;

        this.#renderPreview(draft);
    }

    /** Render the approximate bottom-navigation bar for the current draft. */
    #renderPreview(draft) {
        const visibility = resolveTabVisibility(draft);
        this.preview.innerHTML = '';
        for (const tab of PREVIEW_TABS) {
            if (!tab.always && !visibility[tab.visKey]) continue;
            const item = document.createElement('span');
            item.className = 'nm-tabs-preview-tab';
            const icon = document.createElement('span');
            icon.className = 'nm-tabs-preview-icon';
            icon.innerHTML = tab.icon;
            const label = document.createElement('span');
            label.className = 'nm-tabs-preview-label';
            label.textContent = previewLabel(tab, draft, this.seededLabels);
            item.append(icon, label);
            this.preview.appendChild(item);
        }
    }
}
