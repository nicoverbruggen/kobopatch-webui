import { createDefaultMenuCustomization } from '../nickelmenu/customization.js';

export class Session {
    constructor() {
        this.reset();
    }

    reset() {
        this.manualMode = false;
        this.selectedMode = null;
        this.selectedPrefix = null;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.patchesLoaded = false;
        this.isRestore = false;
        this.nickelMenuOption = null;
        this.nickelMenuCustomization = createDefaultMenuCustomization();
        this.selectedFeatureIds = [];
        this.nmBackupChoice = null;
        this.nmKeepLegacyConfig = false;
        this.nmOptionalCleanupIds = [];
        this.koboUserCount = undefined;
        this.reloadManifest = null;
        this.resultTgz = null;
        this.resultNmZip = null;
    }

    resetDeviceContext() {
        this.selectedPrefix = null;
        this.patchesLoaded = false;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.koboUserCount = undefined;
        this.reloadManifest = null;
        this.resultTgz = null;
        this.resultNmZip = null;
    }
}
