/**
 * NickelMenuSelection.js — The user's NickelMenu choices: what to install or
 * remove, how the toggle menu is customized, and the backup and cleanup
 * decisions made along the way.
 *
 * **Survives a device reconnect on purpose.** `resetDeviceContext` throws away
 * what we learned from the device, not what the user picked, so this class has
 * no `resetDeviceContext` — only the flow restart clears it
 * (`NickelMenuFlow.resetNickelMenuState`). That is the line that keeps this
 * separate from `DetectedInstallation`, which is reset by both.
 */

import { createDefaultMenuCustomization } from '../../nickelmenu/customization.js';
import { createDefaultTabsCustomization } from '../../nickelmenu/features/simplify-tabs/customization.js';
import { createDefaultFontsCustomization } from '../../nickelmenu/features/additional-fonts/customization.js';

export class NickelMenuSelection {
    constructor() {
        /** @type {'preset'|'remove'|null} what the config screen chose */
        this.option = null;
        /** @type {string[]} feature ids to install */
        this.selectedFeatureIds = [];
        /** @type {string[]} feature ids whose optional cleanup the user left checked for removal */
        this.optionalCleanupIds = [];
        /** Keep a pre-existing `.adds/nm/items` file rather than deleting it. */
        this.keepLegacyConfig = false;
        /** @type {'key-files'|'skip'|null} */
        this.backupChoice = null;
        this.menuCustomization = createDefaultMenuCustomization();
        this.tabsCustomization = createDefaultTabsCustomization();
        this.fontsCustomization = createDefaultFontsCustomization();
    }

    /**
     * The choices that follow from the device probe — everything the config and
     * features screens write once they know what is installed.
     *
     * Split out from `resetCustomizations` because `resetNickelMenuState` runs
     * the two halves at different points, around two screen resets. See the
     * ordering note there.
     */
    resetProbeDependentChoices() {
        this.option = null;
        this.selectedFeatureIds = [];
        this.optionalCleanupIds = [];
        this.keepLegacyConfig = false;
    }

    /**
     * The backup choice and the three customizations.
     *
     * **Callers must refresh the summary chips after this**, because the chips
     * render from these values and will otherwise keep showing the old icon and
     * labels.
     */
    resetCustomizations() {
        this.backupChoice = null;
        this.menuCustomization = createDefaultMenuCustomization();
        this.tabsCustomization = createDefaultTabsCustomization();
        this.fontsCustomization = createDefaultFontsCustomization();
    }

    /** Every choice back to its initial value. */
    reset() {
        this.resetProbeDependentChoices();
        this.resetCustomizations();
    }
}
