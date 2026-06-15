import { parseKoboVersion } from './version.js';

function formatDevicePath(pathParts) {
    return pathParts.join('/');
}

function invalidPathPartReason(part) {
    if (typeof part !== 'string') return 'path segments must be strings';
    if (part === '') return 'path segments cannot be empty';
    if (part === '.' || part === '..') return 'path segments cannot be "." or ".."';
    if (part.includes('/') || part.includes('\\')) return 'path segments cannot contain path separators';
    return null;
}

function assertValidDevicePath(pathParts, operation) {
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
        throw new Error(`Invalid device path for ${operation}: expected at least one path segment`);
    }

    for (const part of pathParts) {
        const reason = invalidPathPartReason(part);
        if (reason) {
            throw new Error(`Invalid device path for ${operation}: ${formatDevicePath(pathParts)} (${reason})`);
        }
    }
}

function describeError(err) {
    return err?.message || String(err);
}

function devicePathError(operation, pathParts, err) {
    const wrapped = new Error(
        `Could not ${operation} ${formatDevicePath(pathParts)}: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(pathParts);
    wrapped.deviceOperation = operation;
    wrapped.deviceWrite = operation === 'write';
    return wrapped;
}

function deviceWriteError(pathParts, phase, err) {
    const wrapped = new Error(
        `Could not write ${formatDevicePath(pathParts)} while ${phase}: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(pathParts);
    wrapped.deviceOperation = 'write';
    wrapped.deviceWrite = true;
    wrapped.devicePhase = phase;
    return wrapped;
}

const WRITE_PROBE_PATH = ['.kobopatch-webui', 'write-test.tmp'];
const WRITE_PROBE_CONTENT = 'kobopatch-webui write probe\n';

function deviceWriteProbeError(err) {
    const wrapped = new Error(
        'Could not verify write access to the Kobo drive. The app could read ' +
        '.kobo/version, but a small test write failed. Direct install is not safe ' +
        `for this connection. Details: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(WRITE_PROBE_PATH);
    wrapped.deviceOperation = 'write probe';
    wrapped.deviceWrite = true;
    return wrapped;
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
                throw deviceWriteError(
                    filePath,
                    `opening or creating directory ${formatDevicePath(directoryPath)}`,
                    err
                );
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
        let probeWritten = false;
        let probeError = null;
        try {
            await this.writeFile(WRITE_PROBE_PATH, new TextEncoder().encode(WRITE_PROBE_CONTENT));
            probeWritten = true;

            const written = await this.readFile(WRITE_PROBE_PATH);
            if (written !== WRITE_PROBE_CONTENT) {
                throw new Error('The write probe could not be read back from the Kobo drive.');
            }
        } catch (err) {
            probeError = err;
        }

        if (probeWritten) {
            try {
                await this.removeEntry(WRITE_PROBE_PATH);
            } catch (err) {
                probeError = probeError || err;
            }
        }

        if (probeError) {
            throw deviceWriteProbeError(probeError);
        }
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

    /**
     * Read a byte range from a file without loading the whole thing into memory.
     * getFile() returns a Blob, and Blob.slice() is lazy — only the requested
     * range is read from disk. Used to walk large databases (KoboReader.sqlite)
     * a page at a time rather than slurping hundreds of MB. Returns a Uint8Array
     * (possibly shorter than `length` at EOF), or null if the file is missing.
     */
    async readFileRange(filePath, offset, length) {
        try {
            let dir = this.directoryHandle;
            const dirParts = filePath.slice(0, -1);
            const fileName = filePath[filePath.length - 1];
            for (const part of dirParts) {
                dir = await dir.getDirectoryHandle(part);
            }
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const slice = file.slice(offset, offset + length);
            return new Uint8Array(await slice.arrayBuffer());
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
        let dir = this.directoryHandle;
        const dirParts = pathParts.slice(0, -1);
        for (const part of dirParts) {
            dir = await dir.getDirectoryHandle(part);
        }
        return dir;
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
            if (err?.name === 'NotFoundError') return;
            if (err?.name !== 'TypeMismatchError') throw err;
        }

        if (dirHandle) {
            await this.clearDirectory(dirHandle);
        }

        try {
            await parentHandle.removeEntry(entryName);
        } catch (err) {
            if (err?.name === 'NotFoundError') return;
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
                if (err?.name === 'NotFoundError') continue;
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

// Expose on window for E2E test compatibility (tests access these via page.evaluate)
window.KoboDevice = KoboDevice;

export { KoboDevice };
