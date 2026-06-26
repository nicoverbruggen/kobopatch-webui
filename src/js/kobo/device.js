/**
 * device.js — `KoboDevice`, the File System Access wrapper for a connected Kobo.
 *
 * Validates the picked directory looks like a Kobo and exposes read/list helpers
 * over its filesystem. Writes go through DeviceWriter; this class owns connection
 * and reads. `isSupported()` reports whether the browser exposes the API at all.
 */

import { assertValidDevicePath, formatDevicePath } from './device-paths.js';
import { devicePathError, deviceWriteError, deviceWriteProbeError, isNotFoundError, isTypeMismatchError } from './device-errors.js';
import { parseKoboVersion } from './version.js';
import { readUiLocale } from './locale.js';

class KoboDevice {
    static WRITE_PROBE_PATH = ['.kobopatch-webui-probe'];
    static WRITE_PROBE_CONTENT = 'kobopatch-webui write probe\n';

    constructor() {
        this.directoryHandle = null;
        this.deviceInfo = null;
    }

    reset() {
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
            throw new Error('This does not appear to be a Kobo device. Could not find the .kobo directory.', {
                cause: err,
            });
        }

        let versionFile;
        try {
            versionFile = await koboDir.getFileHandle('version');
        } catch (err) {
            throw new Error('Could not find .kobo/version. Is this the root of your Kobo drive?', { cause: err });
        }

        const file = await versionFile.getFile();
        const content = await file.text();
        this.deviceInfo = KoboDevice.parseVersion(content.trim());
        this.deviceInfo.uiLocale = await this.readUiLocale();

        if (!this.deviceInfo.isIncompatible) {
            try {
                await this.verifyWriteAccess();
            } catch (err) {
                this.disconnect();
                throw err;
            }
        }

        return this.deviceInfo;
    }

    /**
     * Parse the .kobo/version file content.
     *
     * Format: serial,version1,firmware,version3,version4,hardware_uuid
     * Example: N428000000000,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390
     */
    static parseVersion(content) {
        return parseKoboVersion(content);
    }

    /**
     * Get a nested directory handle, creating directories as needed.
     * pathParts is an array like ['.kobo', 'Kobo'].
     */
    async getNestedDirectory(pathParts) {
        assertValidDevicePath(pathParts, 'open directory');
        let dir = this.directoryHandle;
        try {
            for (const part of pathParts) {
                dir = await dir.getDirectoryHandle(part, { create: true });
            }
            return dir;
        } catch (err) {
            throw devicePathError('open or create directory', pathParts, err);
        }
    }

    /**
     * Write a file at a nested path relative to the device root.
     * filePath is like ['.kobo', 'KoboRoot.tgz'] or ['.adds', 'nm', 'items'].
     */
    async writeFile(filePath, data) {
        assertValidDevicePath(filePath, 'write');
        const dirParts = filePath.slice(0, -1);
        const fileName = filePath[filePath.length - 1];
        let dir = this.directoryHandle;

        for (let i = 0; i < dirParts.length; i++) {
            const part = dirParts[i];
            const directoryPath = dirParts.slice(0, i + 1);
            try {
                dir = await dir.getDirectoryHandle(part, { create: true });
            } catch (err) {
                throw deviceWriteError(filePath, `opening or creating directory ${formatDevicePath(directoryPath)}`, err);
            }
        }

        let fileHandle;
        try {
            fileHandle = await dir.getFileHandle(fileName, { create: true });
        } catch (err) {
            throw deviceWriteError(filePath, 'opening or creating the target file', err);
        }

        let writable;
        try {
            writable = await fileHandle.createWritable();
        } catch (err) {
            throw deviceWriteError(filePath, 'creating the writable stream', err);
        }

        try {
            await writable.write(data);
        } catch (err) {
            throw deviceWriteError(filePath, 'writing data', err);
        }

        try {
            await writable.close();
        } catch (err) {
            throw deviceWriteError(filePath, 'committing the write', err);
        }
    }

    /**
     * Confirm that the selected Kobo root can complete the same basic
     * create/write/commit/remove operations the install flows need.
     */
    async verifyWriteAccess() {
        const probePath = KoboDevice.WRITE_PROBE_PATH;
        let probeWritten = false;
        let probeError = null;
        try {
            await this.writeFile(probePath, new TextEncoder().encode(KoboDevice.WRITE_PROBE_CONTENT));
            probeWritten = true;

            const written = await this.readFile(probePath);
            if (written !== KoboDevice.WRITE_PROBE_CONTENT) {
                throw new Error('The write probe could not be read back from the Kobo drive.');
            }
        } catch (err) {
            probeError = err;
        }

        if (probeWritten) {
            try {
                await this.removeEntry(probePath);
            } catch (err) {
                probeError = probeError || err;
            }
        }

        if (probeError) {
            throw deviceWriteProbeError(probeError, probePath);
        }
    }

    /**
     * Resolve a directory handle by walking `pathParts` from the device root.
     * An empty array returns the root. Throws if any segment is missing — the
     * read helpers catch that and degrade to null/[].
     */
    async resolveDirectory(pathParts) {
        let dir = this.directoryHandle;
        for (const part of pathParts) {
            dir = await dir.getDirectoryHandle(part);
        }
        return dir;
    }

    /** Resolve the file handle at `filePath` (directory walk + final getFileHandle). */
    async resolveFileHandle(filePath) {
        const dir = await this.resolveDirectory(filePath.slice(0, -1));
        return dir.getFileHandle(filePath[filePath.length - 1]);
    }

    /**
     * Read the device UI locale from Kobo eReader.conf (best effort). Returns the
     * raw `CurrentLocale` value (e.g. `en`, `fr_CA`) or null when the conf is
     * missing/unreadable or the key is absent.
     */
    async readUiLocale() {
        try {
            const conf = await this.readFile(['.kobo', 'Kobo', 'Kobo eReader.conf']);
            return readUiLocale(conf);
        } catch {
            return null;
        }
    }

    /**
     * Read a file at a nested path. Returns the text content, or null if not found.
     */
    async readFile(filePath) {
        try {
            const fileHandle = await this.resolveFileHandle(filePath);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (err) {
            if (isNotFoundError(err)) return null;
            throw devicePathError('read', filePath, err);
        }
    }

    async readFileBytes(filePath) {
        try {
            const fileHandle = await this.resolveFileHandle(filePath);
            const file = await fileHandle.getFile();
            return new Uint8Array(await file.arrayBuffer());
        } catch (err) {
            if (isNotFoundError(err)) return null;
            throw devicePathError('read', filePath, err);
        }
    }

    /**
     * Read a byte range from a file without loading the whole thing into memory.
     * getFile() returns a Blob, and Blob.slice() is lazy — only the requested
     * range is read from disk. Used to walk large databases (KoboReader.sqlite)
     * a page at a time rather than slurping hundreds of MB. Returns a Uint8Array
     * (possibly shorter than `length` at EOF), or null if the file is missing.
     */
    async readFileRange(filePath, offset, length) {
        try {
            const fileHandle = await this.resolveFileHandle(filePath);
            const file = await fileHandle.getFile();
            const slice = file.slice(offset, offset + length);
            return new Uint8Array(await slice.arrayBuffer());
        } catch (err) {
            if (isNotFoundError(err)) return null;
            throw devicePathError('read', filePath, err);
        }
    }

    /**
     * List direct children for a directory path. Returns [] if the directory is missing.
     */
    async listDirectory(pathParts) {
        try {
            const dir = await this.resolveDirectory(pathParts);
            const entries = [];
            for await (const entry of dir.values()) {
                entries.push({ name: entry.name, kind: entry.kind });
            }
            return entries;
        } catch (err) {
            if (isNotFoundError(err)) return [];
            throw devicePathError('list', pathParts, err);
        }
    }

    /**
     * Check if a file or directory exists at the given path.
     */
    async pathExists(pathParts) {
        try {
            const dir = await this.resolveDirectory(pathParts.slice(0, -1));
            const lastPart = pathParts[pathParts.length - 1];
            try {
                await dir.getDirectoryHandle(lastPart);
                return true;
            } catch (dirErr) {
                if (!isNotFoundError(dirErr) && !isTypeMismatchError(dirErr)) {
                    throw dirErr;
                }
            }

            try {
                await dir.getFileHandle(lastPart);
                return true;
            } catch (fileErr) {
                if (isNotFoundError(fileErr)) return false;
                if (isTypeMismatchError(fileErr)) return true;
                throw fileErr;
            }
        } catch (err) {
            if (isNotFoundError(err)) return false;
            throw devicePathError('check existence of', pathParts, err);
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
        let dir;
        try {
            dir = await this.resolveDirectory(pathParts.slice(0, -1));
        } catch (err) {
            if (isNotFoundError(err)) return;
            throw devicePathError('open directory', pathParts.slice(0, -1), err);
        }
        const entryName = pathParts[pathParts.length - 1];

        try {
            const childDir = await dir.getDirectoryHandle(entryName);
            await this.collectDirectoryFilePaths(childDir, pathParts, filePaths);
            return;
        } catch (err) {
            if (isNotFoundError(err)) return;
            if (!isTypeMismatchError(err)) {
                throw devicePathError('check directory', pathParts, err);
            }
        }

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
                const childDir = typeof entry.values === 'function' ? entry : await dirHandle.getDirectoryHandle(entry.name);
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
     *
     * Recursive directory removals are done manually — descending depth-first
     * and deleting entries one-by-one — rather than via the native
     * `removeEntry(..., { recursive: true })`, which can throw `NotFoundError`
     * partway through the tree on removable exFAT volumes (notably Kobo drives).
     * The manual walk tolerates per-entry `NotFoundError` (an already-gone entry
     * counts as success), so the whole tree comes down reliably.
     */
    async removeEntry(pathParts, options = {}) {
        const parent = await this.resolveParentHandle(pathParts);
        const entryName = pathParts[pathParts.length - 1];

        if (!options.recursive) {
            await parent.removeEntry(entryName, options);
            return;
        }

        await this.removeEntryRecursively(parent, entryName);
    }

    /**
     * Resolve the directory handle that contains the final segment of `pathParts`.
     */
    async resolveParentHandle(pathParts) {
        return this.resolveDirectory(pathParts.slice(0, -1));
    }

    /**
     * Manually delete `entryName` (file or directory) from `parentHandle`,
     * descending depth-first and treating missing entries as already removed.
     */
    async removeEntryRecursively(parentHandle, entryName) {
        let dirHandle = null;
        try {
            dirHandle = await parentHandle.getDirectoryHandle(entryName);
        } catch (err) {
            // NotFoundError → already gone. TypeMismatchError → it's a file, so
            // drop through to the plain removeEntry below. Anything else is real.
            if (isNotFoundError(err)) return;
            if (!isTypeMismatchError(err)) throw err;
        }

        if (dirHandle) {
            await this.clearDirectory(dirHandle);
        }

        try {
            await parentHandle.removeEntry(entryName);
        } catch (err) {
            if (isNotFoundError(err)) return;
            throw err;
        }
    }

    /**
     * Recursively remove every child of `dirHandle`, leaving it empty.
     * Entries that have already vanished (`NotFoundError`) are skipped.
     */
    async clearDirectory(dirHandle) {
        if (typeof dirHandle.values !== 'function') return;

        const children = [];
        for await (const entry of dirHandle.values()) {
            children.push({ name: entry.name, kind: entry.kind });
        }

        for (const { name, kind } of children) {
            try {
                if (kind === 'directory') {
                    const child = await dirHandle.getDirectoryHandle(name);
                    await this.clearDirectory(child);
                }
                await dirHandle.removeEntry(name);
            } catch (err) {
                if (isNotFoundError(err)) continue;
                throw err;
            }
        }
    }

    /**
     * Disconnect / release the directory handle.
     */
    disconnect() {
        this.directoryHandle = null;
        this.deviceInfo = null;
    }
}

export { KoboDevice };
