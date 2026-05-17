import { parseKoboVersion } from './version.js';

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
        return parseKoboVersion(content);
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
            let dir = this.directoryHandle;
            const dirParts = filePath.slice(0, -1);
            const fileName = filePath[filePath.length - 1];
            for (const part of dirParts) {
                dir = await dir.getDirectoryHandle(part);
            }
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    /**
     * List direct children for a directory path. Returns [] if the directory is missing.
     */
    async listDirectory(pathParts) {
        try {
            let dir = this.directoryHandle;
            for (const part of pathParts) {
                dir = await dir.getDirectoryHandle(part);
            }
            const entries = [];
            for await (const entry of dir.values()) {
                entries.push({ name: entry.name, kind: entry.kind });
            }
            return entries;
        } catch {
            return [];
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

    async readFileBytes(filePath) {
        try {
            let dir = this.directoryHandle;
            const dirParts = filePath.slice(0, -1);
            const fileName = filePath[filePath.length - 1];
            for (const part of dirParts) {
                dir = await dir.getDirectoryHandle(part);
            }
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return new Uint8Array(await file.arrayBuffer());
        } catch {
            return null;
        }
    }

    async collectExistingEntries(pathList, progressFn) {
        const filePaths = [];
        for (const pathParts of pathList) {
            await this.collectExistingFilePaths(pathParts, filePaths);
        }
        return this.collectFilesAtPaths(filePaths, progressFn);
    }

    async collectExistingFilePaths(pathParts, filePaths) {
        let dir = this.directoryHandle;
        const dirParts = pathParts.slice(0, -1);
        const entryName = pathParts[pathParts.length - 1];

        try {
            for (const part of dirParts) {
                dir = await dir.getDirectoryHandle(part);
            }
        } catch {
            return;
        }

        try {
            const childDir = await dir.getDirectoryHandle(entryName);
            await this.collectDirectoryFilePaths(childDir, pathParts, filePaths);
            return;
        } catch {}

        const data = await this.readFileBytes(pathParts);
        if (data) {
            filePaths.push(pathParts);
        }
    }

    async collectDirectoryFilePaths(dirHandle, currentPathParts, filePaths) {
        if (typeof dirHandle.values !== 'function') return;

        for await (const entry of dirHandle.values()) {
            const nextPathParts = [...currentPathParts, entry.name];
            if (entry.kind === 'directory') {
                const childDir = typeof entry.values === 'function'
                    ? entry
                    : await dirHandle.getDirectoryHandle(entry.name);
                await this.collectDirectoryFilePaths(childDir, nextPathParts, filePaths);
            } else if (entry.kind === 'file') {
                filePaths.push(nextPathParts);
            }
        }
    }

    async collectFilesAtPaths(filePaths, progressFn) {
        const entries = [];
        const total = filePaths.length;

        for (let i = 0; i < filePaths.length; i++) {
            const pathParts = filePaths[i];
            const data = await this.readFileBytes(pathParts);
            if (!data) continue;
            entries.push({ path: pathParts.join('/'), data });
            if (progressFn) {
                progressFn({
                    phase: 'reading',
                    current: i + 1,
                    total,
                    path: pathParts.join('/'),
                });
            }
        }

        return entries;
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

export { KoboDevice };
