/**
 * Known Kobo device serial prefixes mapped to model names.
 * Source: https://help.kobo.com/hc/en-us/articles/360019676973
 * The serial number prefix (first 3-4 characters) identifies the model.
 */
const KoboModels = {
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
        } catch (err) {
            throw new Error(
                'This does not appear to be a Kobo device. Could not find the .kobo directory.',
                { cause: err }
            );
        }

        let versionFile;
        try {
            versionFile = await koboDir.getFileHandle('version');
        } catch (err) {
            throw new Error(
                'Could not find .kobo/version. Is this the root of your Kobo drive?',
                { cause: err }
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
        const serialPrefix = KoboModels[serial.substring(0, 4)]
            ? serial.substring(0, 4)
            : serial.substring(0, 3);
        const model = KoboModels[serialPrefix] || 'Unknown Kobo (' + serial.substring(0, 4) + ')';
        const fwParts = firmware.split('.');
        const fwMajor = parseInt(fwParts[0], 10) || 0;
        const fwMinor = parseInt(fwParts[1], 10) || 0;
        const isIncompatible = !(fwMajor === 4 && fwMinor >= 6);

        return {
            serial,
            serialPrefix,
            firmware,
            hardwareId,
            model,
            isIncompatible,
        };
    }

    /**
     * Get a nested directory handle, creating directories as needed.
     * pathParts is an array like ['.kobo', 'Kobo'].
     */
    async getNestedDirectory(pathParts) {
        let dir = this.directoryHandle;
        for (const part of pathParts) {
            dir = await dir.getDirectoryHandle(part, { create: true });
        }
        return dir;
    }

    /**
     * Write a file at a nested path relative to the device root.
     * filePath is like ['.kobo', 'KoboRoot.tgz'] or ['.adds', 'nm', 'items'].
     */
    async writeFile(filePath, data) {
        const dirParts = filePath.slice(0, -1);
        const fileName = filePath[filePath.length - 1];
        const dir = dirParts.length > 0
            ? await this.getNestedDirectory(dirParts)
            : this.directoryHandle;
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    /**
     * Read a file at a nested path. Returns the text content, or null if not found.
     */
    async readFile(filePath) {
        try {
            const dirParts = filePath.slice(0, -1);
            const fileName = filePath[filePath.length - 1];
            const dir = dirParts.length > 0
                ? await this.getNestedDirectory(dirParts)
                : this.directoryHandle;
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    /**
     * Check if a file or directory exists at the given path.
     */
    async pathExists(pathParts) {
        try {
            let dir = this.directoryHandle;
            const dirParts = pathParts.slice(0, -1);
            const lastPart = pathParts[pathParts.length - 1];
            for (const part of dirParts) {
                dir = await dir.getDirectoryHandle(part);
            }
            try {
                await dir.getDirectoryHandle(lastPart);
                return true;
            } catch {
                await dir.getFileHandle(lastPart);
                return true;
            }
        } catch {
            return false;
        }
    }

    /**
     * List the names of files and directories directly inside a directory.
     * Returns an empty array if the path cannot be read.
     */
    async listDirectoryNames(pathParts = []) {
        try {
            let dir = this.directoryHandle;
            for (const part of pathParts) {
                dir = await dir.getDirectoryHandle(part);
            }

            const names = [];
            if (typeof dir.values === 'function') {
                for await (const entry of dir.values()) {
                    names.push(entry.name);
                }
                return names;
            }
            if (typeof dir[Symbol.asyncIterator] === 'function') {
                for await (const entry of dir) {
                    names.push(entry.name);
                }
                return names;
            }
            return [];
        } catch {
            return [];
        }
    }

    /**
     * Remove a file or directory at the given path.
     */
    async removeEntry(pathParts, options = {}) {
        let dir = this.directoryHandle;
        const dirParts = pathParts.slice(0, -1);
        const entryName = pathParts[pathParts.length - 1];
        for (const part of dirParts) {
            dir = await dir.getDirectoryHandle(part);
        }
        await dir.removeEntry(entryName, options);
    }

    /**
     * Disconnect / release the directory handle.
     */
    disconnect() {
        this.directoryHandle = null;
        this.deviceInfo = null;
    }
}

// Expose on window for E2E test compatibility (tests access these via page.evaluate)
window.KoboDevice = KoboDevice;

export { KoboModels, KoboDevice };
