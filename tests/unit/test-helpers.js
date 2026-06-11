import JSZip from 'jszip';

import { NickelMenuInstaller } from '../../src/js/nickelmenu/installer.js';

const koboEReaderConfPath = '.kobo/Kobo/Kobo eReader.conf';
const koboRootTgzPath = '.kobo/KoboRoot.tgz';

function bytes(value) {
    return new TextEncoder().encode(value);
}

function text(value) {
    return new TextDecoder().decode(value);
}

function createInstaller(tgz = bytes('nickelmenu tgz')) {
    const installer = new NickelMenuInstaller();
    installer.nickelMenuZip = new JSZip();
    installer.nickelMenuZip.file('KoboRoot.tgz', tgz);
    return installer;
}

function createProgressRecorder() {
    const messages = [];
    const record = (message) => messages.push(message);
    record.messages = messages;
    return record;
}

function arrayBufferFor(value) {
    const data = value instanceof Uint8Array ? value : bytes(value);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function createResponse(body, { status = 200, json = null } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async arrayBuffer() {
            return arrayBufferFor(body);
        },
        async json() {
            return json;
        },
    };
}

function useCustomMenuAssetFetch() {
    const originalFetch = globalThis.fetch;
    // The items file is generated from feature menuItems hooks now. custom-menu
    // fetches the menu icon; the home-content hiders fetch their shared toggle
    // script (simplify-tabs fetches its own toggle script via ctx.asset).
    const assets = new Map([
        ['js/nickelmenu/features/custom-menu/.cog.png', 'cog png'],
        ['js/nickelmenu/features/hide-home-content/scripts/toggle_hidden_home.sh', '#!/bin/sh\ntoggle home'],
    ]);

    globalThis.fetch = async (url) => {
        if (!assets.has(url)) {
            return { ok: false, status: 404 };
        }

        return {
            ok: true,
            async arrayBuffer() {
                return arrayBufferFor(assets.get(url));
            },
        };
    };

    return () => {
        globalThis.fetch = originalFetch;
    };
}

class RecordingDevice {
    constructor({ textFiles = {}, existingEntries = [], failWritePath = null, failRemovePaths = [] } = {}) {
        this.textFiles = new Map(Object.entries(textFiles));
        this.failWritePath = failWritePath;
        this.failRemovePaths = new Set(failRemovePaths);
        this.writes = [];
        this.removals = [];
        this.entryKinds = new Map();

        for (const [path] of this.textFiles) {
            this.addEntry(path, 'file');
        }

        for (const entry of existingEntries) {
            if (typeof entry === 'string') {
                this.addEntry(entry, 'directory');
            } else {
                this.addEntry(entry.path, entry.kind);
            }
        }
    }

    addEntry(path, kind) {
        const parts = path.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
            this.entryKinds.set(currentPath, 'directory');
        }

        this.entryKinds.set(path, kind);
    }

    listChildPaths(path) {
        const prefix = path + '/';
        const children = [];

        for (const entryPath of this.entryKinds.keys()) {
            if (!entryPath.startsWith(prefix)) continue;
            const relative = entryPath.slice(prefix.length);
            if (!relative || relative.includes('/')) continue;
            children.push(entryPath);
        }

        return children;
    }

    async readFile(pathParts) {
        return this.textFiles.get(pathParts.join('/')) ?? null;
    }

    async writeFile(pathParts, data) {
        const path = pathParts.join('/');
        if (path === this.failWritePath) {
            throw new Error(`Refusing write to ${path}`);
        }

        const bytesData = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.writes.push({ path, data: bytesData });
        this.addEntry(path, 'file');
        if (path === koboEReaderConfPath) {
            this.textFiles.set(path, text(bytesData));
        }
    }

    async listDirectory(pathParts) {
        const path = pathParts.join('/');
        if (!this.entryKinds.has(path)) return [];

        return this.listChildPaths(path).map(childPath => ({
            name: childPath.slice(path.length + 1),
            kind: this.entryKinds.get(childPath),
        }));
    }

    async pathExists(pathParts) {
        return this.entryKinds.has(pathParts.join('/'));
    }

    async removeEntry(pathParts, options = {}) {
        const path = pathParts.join('/');
        if (this.failRemovePaths.has(path)) {
            throw new Error(`Refusing remove of ${path}`);
        }

        const kind = this.entryKinds.get(path);
        if (!kind) {
            throw new Error(`Refusing remove of missing ${path}`);
        }

        if (kind === 'directory' && !options.recursive && this.listChildPaths(path).length > 0) {
            throw new Error(`Refusing remove of non-empty directory ${path}`);
        }

        this.removals.push({ path, options });
        if (kind === 'directory' && options.recursive) {
            const prefix = path + '/';
            for (const entryPath of [...this.entryKinds.keys()]) {
                if (entryPath === path || entryPath.startsWith(prefix)) {
                    this.entryKinds.delete(entryPath);
                    this.textFiles.delete(entryPath);
                }
            }
            return;
        }

        this.entryKinds.delete(path);
        this.textFiles.delete(path);
    }

    writePaths() {
        return this.writes.map(write => write.path);
    }

    removePaths() {
        return this.removals.map(remove => remove.path);
    }

    writeFor(path) {
        return this.writes.find(write => write.path === path);
    }

    removalFor(path) {
        return this.removals.find(remove => remove.path === path);
    }
}

export {
    RecordingDevice,
    bytes,
    createResponse,
    createInstaller,
    createProgressRecorder,
    koboEReaderConfPath,
    koboRootTgzPath,
    text,
    useCustomMenuAssetFetch,
};
