/**
 * Known Kobo device serial prefixes mapped to model names.
 * Source: https://help.kobo.com/hc/en-us/articles/360019676973
 * The serial number prefix (first 3-4 characters) identifies the model.
 */
const KOBO_MODELS = {
    // Current eReaders
    'N428': 'Kobo Libra Colour',
    'N367': 'Kobo Clara Colour',
    'N365': 'Kobo Clara BW',
    'P365': 'Kobo Clara BW',
    'N605': 'Kobo Elipsa 2E',
    'N506': 'Kobo Clara 2E',
    'N778': 'Kobo Sage',
    'N418': 'Kobo Libra 2',
    'N604': 'Kobo Elipsa',
    'N306': 'Kobo Nia',
    'N873': 'Kobo Libra H2O',
    'N782': 'Kobo Forma',
    'N249': 'Kobo Clara HD',
    'N867': 'Kobo Aura H2O Edition 2',
    'N709': 'Kobo Aura ONE',
    'N236': 'Kobo Aura Edition 2',
    'N587': 'Kobo Touch 2.0',
    'N437': 'Kobo Glo HD',
    'N250': 'Kobo Aura H2O',
    'N514': 'Kobo Aura',
    'N613': 'Kobo Glo',
    'N705': 'Kobo Mini',
    'N416': 'Kobo Original',
    // Older models with multiple revisions
    'N905': 'Kobo Touch',
    'N647': 'Kobo Wireless',
    'N47B': 'Kobo Wireless',
    // Aura HD uses 5-char prefix
    'N204': 'Kobo Aura HD',
};

/**
 * Firmware download URLs by version and serial prefix.
 * Source: https://help.kobo.com/hc/en-us/articles/35059171032727
 *
 * The kobo prefix (kobo12, kobo13, kobo14) is stable per device family.
 * The date path segment (e.g. Mar2026) changes per release.
 * help.kobo.com may lag behind; verify URLs when adding new versions.
 */
const FIRMWARE_DOWNLOADS = {
    '4.45.23646': {
        'N428': 'https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-4.45.23646.zip',
        'N365': 'https://ereaderfiles.kobo.com/firmwares/kobo12/Mar2026/kobo-update-4.45.23646.zip',
        'N367': 'https://ereaderfiles.kobo.com/firmwares/kobo12/Mar2026/kobo-update-4.45.23646.zip',
        'P365': 'https://ereaderfiles.kobo.com/firmwares/kobo14/Mar2026/kobo-update-4.45.23646.zip',
    },
};

/**
 * Supported firmware versions for patching (derived from FIRMWARE_DOWNLOADS).
 */
const SUPPORTED_FIRMWARE = Object.keys(FIRMWARE_DOWNLOADS);

/**
 * Get the firmware download URL for a given serial prefix and firmware version.
 * Returns null if no URL is available.
 */
function getFirmwareURL(serialPrefix, version) {
    const versionMap = FIRMWARE_DOWNLOADS[version];
    if (!versionMap) return null;
    return versionMap[serialPrefix] || null;
}

/**
 * Get all device models that have firmware downloads for a given version.
 * Returns array of { prefix, model } objects.
 */
function getDevicesForVersion(version) {
    const versionMap = FIRMWARE_DOWNLOADS[version];
    if (!versionMap) return [];
    const devices = [];
    for (const prefix of Object.keys(versionMap)) {
        const model = KOBO_MODELS[prefix] || 'Unknown';
        devices.push({ prefix, model: model + ' (' + prefix + ')' });
    }
    return devices;
}

class KoboDevice {
    constructor() {
        this.directoryHandle = null;
        this.deviceInfo = null;
    }

    /**
     * Check if the File System Access API is available.
     */
    static isSupported() {
        return 'showDirectoryPicker' in window;
    }

    /**
     * Prompt the user to select the Kobo drive root directory.
     * Validates that it looks like a Kobo by checking for .kobo/version.
     */
    async connect() {
        this.directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite',
        });

        // Verify this looks like a Kobo root
        let koboDir;
        try {
            koboDir = await this.directoryHandle.getDirectoryHandle('.kobo');
        } catch {
            throw new Error(
                'This does not appear to be a Kobo device. Could not find the .kobo directory.'
            );
        }

        let versionFile;
        try {
            versionFile = await koboDir.getFileHandle('version');
        } catch {
            throw new Error(
                'Could not find .kobo/version. Is this the root of your Kobo drive?'
            );
        }

        const file = await versionFile.getFile();
        const content = await file.text();
        this.deviceInfo = KoboDevice.parseVersion(content.trim());
        return this.deviceInfo;
    }

    /**
     * Parse the .kobo/version file content.
     *
     * Format: serial,version1,firmware,version3,version4,hardware_uuid
     * Example: N4284B5215352,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390
     */
    static parseVersion(content) {
        const parts = content.split(',');
        if (parts.length < 6) {
            throw new Error(
                'Unexpected version file format. Expected 6 comma-separated fields, got ' + parts.length
            );
        }

        const serial = parts[0];
        const firmware = parts[2];
        const hardwareId = parts[5];

        // Try matching 4-char prefix first, then 3-char for models like N204B
        const serialPrefix = KOBO_MODELS[serial.substring(0, 4)]
            ? serial.substring(0, 4)
            : serial.substring(0, 3);
        const model = KOBO_MODELS[serialPrefix] || 'Unknown Kobo (' + serial.substring(0, 4) + ')';
        const isSupported = SUPPORTED_FIRMWARE.includes(firmware);

        return {
            serial,
            serialPrefix,
            firmware,
            hardwareId,
            model,
            isSupported,
        };
    }

    /**
     * Disconnect / release the directory handle.
     */
    disconnect() {
        this.directoryHandle = null;
        this.deviceInfo = null;
    }
}
