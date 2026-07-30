/**
 * session.js — The shared wizard `state` object.
 *
 * Creates the single mutable state bag every flow reads from and writes to
 * (device, selections, build artifacts, the showError hook), with its initial
 * defaults.
 */

import { createDefaultMenuCustomization } from '../nickelmenu/customization.js';
import { createDefaultTabsCustomization } from '../nickelmenu/features/simplify-tabs/customization.js';
import { createDefaultFontsCustomization } from '../nickelmenu/features/additional-fonts/customization.js';

export class Session {
    constructor() {
        // Long-lived services, assigned by app.js after construction. Declared
        // here so the object's full shape is discoverable, not just the data.
        this.device = null;
        this.patchUI = null;
        this.runner = null;
        this.nmInstaller = null;
        this.getSoftwareUrl = null;

        // Async resource handles/values, assigned by app.js once the loads start.
        this.softwareUrlsReady = null;
        this.availablePatchesReady = null;
        this.availablePatches = null;
        this.blacklistReady = null;

        // Cross-flow navigation callbacks, assigned by the flow/shell modules.
        // These are how flows hand control back to shared steps.
        this.showError = null;
        this.goToModeSelection = null;
        this.goBackToDeviceStep = null;
        this.goToManualVersionStep = null;

        this.reset();
    }

    reset() {
        this.manualMode = false;
        this.selectedMode = null;
        this.selectedChannel = null;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.patchesUnavailableReason = null;
        this.patchesLoaded = false;
        this.hasCustomPatchesManifest = false;
        this.isRestore = false;
        this.nickelMenuOption = null;
        this.nickelMenuCustomization = createDefaultMenuCustomization();
        this.nickelMenuTabsCustomization = createDefaultTabsCustomization();
        this.nickelMenuFontsCustomization = createDefaultFontsCustomization();
        this.selectedFeatureIds = [];
        this.previousNickelMenuFeatureIds = [];
        this.nmBackupChoice = null;
        this.nmKeepLegacyConfig = false;
        this.nmOptionalCleanupIds = [];
        this.koboUserCount = undefined;
        this.reloadManifest = null;
        this.reloadAdditionalFiles = null;
        this.resultTgz = null;
        this.resultNmZip = null;
    }

    resetDeviceContext() {
        this.selectedChannel = null;
        this.patchesLoaded = false;
        this.hasCustomPatchesManifest = false;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.patchesUnavailableReason = null;
        this.koboUserCount = undefined;
        this.previousNickelMenuFeatureIds = [];
        this.reloadManifest = null;
        this.reloadAdditionalFiles = null;
        this.resultTgz = null;
        this.resultNmZip = null;
    }
}
