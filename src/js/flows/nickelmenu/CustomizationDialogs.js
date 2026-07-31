/**
 * CustomizationDialogs.js — The registry of feature customize dialogs.
 *
 * Constructs one dialog per customizable feature and keys them by the `type`
 * that feature declares in its `customization` block. Everything that used to
 * dispatch on that type — opening a dialog, building a feature's summary chip,
 * adopting a previous configuration — now goes through this map, so none of it
 * knows which features exist.
 *
 * **Adding a fourth customizable feature is a new subclass in that feature's own
 * directory, a `type` on its feature entry, and one line here.** Nothing in this
 * file or in `CustomizationDialog` should ever need to name a feature.
 */

import { MenuCustomizationDialog } from '../../nickelmenu/features/custom-menu/MenuCustomizationDialog.js';
import { TabsCustomizationDialog } from '../../nickelmenu/features/simplify-tabs/TabsCustomizationDialog.js';
import { FontsCustomizationDialog } from '../../nickelmenu/features/additional-fonts/FontsCustomizationDialog.js';

export class CustomizationDialogs {
    /**
     * @param {object} session - the shared wizard session, for the device locale
     * @param {import('./NickelMenuSelection.js').NickelMenuSelection} selection - the user's choices
     * @param {import('./CustomizationDrafts.js').CustomizationDrafts} drafts
     * @param {AbortSignal} signal - the flow's listener signal; see `Step`
     */
    constructor(session, selection, drafts, signal) {
        // The session survives here for exactly one thing: the tabs dialog seeds
        // its label placeholders from the device's UI locale, and the device
        // connects long after this is constructed — hence a function, not a value.
        const uiLocale = () => session.device?.deviceInfo?.uiLocale;

        /** @type {Map<string, import('../../nickelmenu/CustomizationDialog.js').CustomizationDialog>} */
        this.byType = new Map(
            [
                new MenuCustomizationDialog({ selection, drafts, signal }),
                new TabsCustomizationDialog({ selection, drafts, uiLocale, signal }),
                new FontsCustomizationDialog({ selection, drafts, signal }),
            ].map((dialog) => [dialog.type, dialog]),
        );
    }

    /** Every dialog, in registration order. */
    all() {
        return this.byType.values();
    }

    /**
     * Open a feature's dialog, seeded from what is currently committed.
     *
     * @param {string} type - the feature's `customization.type`
     * @param {HTMLElement} triggerEl - the control that opened it, for focus return
     */
    open(type, triggerEl) {
        this.byType.get(type)?.open(triggerEl);
    }

    /**
     * The summary-chip fields for a feature's row in the feature list.
     *
     * @param {string} type
     * @returns {object} spread into the checkbox-list item, or `{}` for an unknown type
     */
    summaryItem(type) {
        return this.byType.get(type)?.summaryItem() ?? {};
    }

    /**
     * Let each dialog adopt its slice of a previous on-device configuration.
     *
     * The gates differ per feature — the menu has none, tabs and fonts require
     * their feature id to have been selected — so each dialog decides for itself
     * rather than this loop applying a uniform rule.
     *
     * @param {object|null} previous
     * @param {Set<string>} previousIds
     */
    adoptPrevious(previous, previousIds) {
        for (const dialog of this.all()) {
            dialog.adoptPrevious(previous, previousIds);
        }
    }
}
