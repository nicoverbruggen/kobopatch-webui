/**
 * CustomizationDrafts.js — The working copies the three customize dialogs edit,
 * plus the generation counter that keeps a slow icon upload from writing into a
 * newer dialog session.
 *
 * A menu draft goes stale two different ways, and both have to be tracked:
 * opening the dialog installs a *different* draft object, while saving keeps the
 * same draft object and only ends the session. A callback that checks one of the
 * two lets a pending upload write into committed state.
 *
 * The tabs and fonts drafts have no counter and need none — neither dialog reads
 * a file asynchronously. That is baseline behavior, not an oversight to correct.
 */

import { cloneMenuCustomization } from '../../nickelmenu/MenuCustomization.js';
import { cloneTabsCustomization } from '../../nickelmenu/features/simplify-tabs/TabsCustomization.js';
import { cloneFontsCustomization } from '../../nickelmenu/features/additional-fonts/FontsCustomization.js';

export class CustomizationDrafts {
    /** @param {import('./NickelMenuSelection.js').NickelMenuSelection} selection */
    constructor(selection) {
        this.menu = cloneMenuCustomization(selection.menuCustomization);
        this.tabs = cloneTabsCustomization(selection.tabsCustomization);
        this.fonts = cloneFontsCustomization(selection.fontsCustomization);
        this.menuGeneration = 0;
    }

    /**
     * Snapshot identifying the live menu session, for an async callback to
     * re-check before it applies anything.
     *
     * @returns {{draft: object, generation: number}}
     */
    menuToken() {
        return { draft: this.menu, generation: this.menuGeneration };
    }

    /**
     * Whether `token` still identifies the live menu session.
     *
     * Both halves are required. Identity alone covers reopen, Reset, restore and
     * flow reset, because each installs a different draft object. The counter
     * covers the one case identity cannot: Save commits a copy
     * (`{ ...draft, label }`) and leaves `this.menu` pointing at the same object,
     * so only the generation bump invalidates an upload still in flight.
     *
     * @param {{draft: object, generation: number}} token
     */
    isCurrentMenu(token) {
        return token.draft === this.menu && token.generation === this.menuGeneration;
    }

    /**
     * Install a new menu draft. Deliberately does not end the session — opening
     * a dialog is not a commit, and the baseline open path does not bump.
     */
    setMenu(draft) {
        this.menu = draft;
    }

    /**
     * End the current menu session so in-flight upload callbacks are ignored.
     * Kept separate from `setMenu` because the baseline bumps without replacing
     * (Save) and replaces without bumping (open); a combined helper would delete
     * the protection that separation exists for.
     */
    endMenuSession() {
        this.menuGeneration++;
    }

    /**
     * Re-clone all three drafts from the selection's current customizations and
     * end the menu session. Called from the flow's reset, after the selection has
     * been put back to its defaults.
     *
     * @param {import('./NickelMenuSelection.js').NickelMenuSelection} selection
     */
    reset(selection) {
        this.menu = cloneMenuCustomization(selection.menuCustomization);
        this.endMenuSession();
        this.tabs = cloneTabsCustomization(selection.tabsCustomization);
        this.fonts = cloneFontsCustomization(selection.fontsCustomization);
    }
}
