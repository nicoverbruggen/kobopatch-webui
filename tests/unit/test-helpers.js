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
    const assets = new Map([
        ['js/nickelmenu/features/custom-menu/items', 'menu_item :main :base'],
        ['js/nickelmenu/features/custom-menu/.cog.png', 'cog png'],
        ['js/nickelmenu/features/custom-menu/scripts/legibility_status.sh', '#!/bin/sh\nlegibility'],
        ['js/nickelmenu/features/custom-menu/scripts/toggle_wk_rendering.sh', '#!/bin/sh\ntoggle'],
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
    constructor({ textFiles = {}, failWritePath = null, failRemovePaths = [] } = {}) {
        this.textFiles = new Map(Object.entries(textFiles));
        this.failWritePath = failWritePath;
        this.failRemovePaths = new Set(failRemovePaths);
        this.writes = [];
        this.removals = [];
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
        if (path === koboEReaderConfPath) {
            this.textFiles.set(path, text(bytesData));
        }
    }

    async removeEntry(pathParts, options = {}) {
        const path = pathParts.join('/');
        if (this.failRemovePaths.has(path)) {
            throw new Error(`Refusing remove of ${path}`);
        }

        this.removals.push({ path, options });
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
