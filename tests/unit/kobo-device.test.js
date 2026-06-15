import test from 'node:test';
import assert from 'node:assert/strict';

import { bytes, text } from './test-helpers.js';

globalThis.window = {};
const { KoboDevice } = await import('../../src/js/kobo/device.js');

function copyBytes(data) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function normalizeBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return bytes(data);
}

function domError(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
}

class MockFileHandle {
    constructor(name, data = new Uint8Array()) {
        this.name = name;
        this.kind = 'file';
        this.data = normalizeBytes(data);
        this.writes = [];
    }

    async getFile() {
        const handle = this;
        return {
            async text() {
                return text(handle.data);
            },
            async arrayBuffer() {
                return copyBytes(handle.data);
            },
        };
    }

    async createWritable() {
        const handle = this;
        const chunks = [];
        return {
            async write(chunk) {
                chunks.push(normalizeBytes(chunk));
            },
            async close() {
                const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
                const merged = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) {
                    merged.set(chunk, offset);
                    offset += chunk.length;
                }
                handle.data = merged;
                handle.writes.push(merged);
            },
        };
    }
}

class MockDirectoryHandle {
    constructor(name) {
        this.name = name;
        this.kind = 'directory';
        this.children = new Map();
        this.removals = [];
    }

    async getDirectoryHandle(name, options = {}) {
        const existing = this.children.get(name);
        if (existing?.kind === 'directory') return existing;
        if (existing) throw domError('TypeMismatchError', `${name} is not a directory`);
        if (!options.create) throw domError('NotFoundError', `Missing directory ${name}`);

        const directory = new MockDirectoryHandle(name);
        this.children.set(name, directory);
        return directory;
    }

    async getFileHandle(name, options = {}) {
        const existing = this.children.get(name);
        if (existing?.kind === 'file') return existing;
        if (existing) throw domError('TypeMismatchError', `${name} is not a file`);
        if (!options.create) throw domError('NotFoundError', `Missing file ${name}`);

        const file = new MockFileHandle(name);
        this.children.set(name, file);
        return file;
    }

    async removeEntry(name, options = {}) {
        const existing = this.children.get(name);
        if (!existing) throw domError('NotFoundError', `Missing entry ${name}`);
        if (existing.kind === 'directory' && existing.children.size > 0 && !options.recursive) {
            throw domError('InvalidModificationError', `Directory ${name} is not empty`);
        }

        this.removals.push({ name, options });
        this.children.delete(name);
    }

    async *values() {
        yield* this.children.values();
    }

    async addDirectory(pathParts) {
        let dir = this;
        for (const part of pathParts) {
            dir = await dir.getDirectoryHandle(part, { create: true });
        }
        return dir;
    }

    async addFile(pathParts, data) {
        const dir = await this.addDirectory(pathParts.slice(0, -1));
        const file = new MockFileHandle(pathParts[pathParts.length - 1], data);
        dir.children.set(file.name, file);
        return file;
    }
}

async function getDirectory(root, pathParts) {
    let dir = root;
    for (const part of pathParts) {
        dir = await dir.getDirectoryHandle(part);
    }
    return dir;
}

async function getFile(root, pathParts) {
    const dir = await getDirectory(root, pathParts.slice(0, -1));
    return dir.getFileHandle(pathParts[pathParts.length - 1]);
}

function createDevice(root = new MockDirectoryHandle('root')) {
    const device = new KoboDevice();
    device.directoryHandle = root;
    return { device, root };
}

const versionText = 'N4280A0000000,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390';

test('connect verifies write access with a small probe after reading the version', async () => {
    const root = new MockDirectoryHandle('root');
    await root.addFile(['.kobo', 'version'], versionText);
    window.showDirectoryPicker = async () => root;

    const device = new KoboDevice();
    const info = await device.connect();

    assert.equal(info.model, 'Kobo Libra Colour');
    assert.equal(await device.pathExists(['.kobopatch-webui-probe']), false);

    assert.deepEqual(root.removals, [
        { name: '.kobopatch-webui-probe', options: {} },
    ]);
});

test('connect reports write-probe failures as device write errors and disconnects', async () => {
    const root = new MockDirectoryHandle('root');
    await root.addFile(['.kobo', 'version'], versionText);
    root.getFileHandle = async (name, options = {}) => {
        if (!options.create) throw domError('NotFoundError', `Missing file ${name}`);

        const file = new MockFileHandle(name);
        file.createWritable = async () => ({
            async write() {},
            async close() {
                throw domError(
                    'NotFoundError',
                    'A requested file or directory could not be found at the time an operation was processed'
                );
            },
        });
        root.children.set(name, file);
        return file;
    };
    window.showDirectoryPicker = async () => root;

    const device = new KoboDevice();

    await assert.rejects(
        () => device.connect(),
        (err) => {
            assert.match(err.message, /Could not verify write access to the Kobo drive/);
            assert.match(err.message, /Could not write \.kobopatch-webui-probe/);
            assert.match(err.message, /while committing the write/);
            assert.equal(err.deviceWrite, true);
            assert.equal(err.devicePath, '.kobopatch-webui-probe');
            assert.equal(err.deviceOperation, 'write probe');
            return true;
        }
    );
    assert.equal(device.directoryHandle, null);
    assert.equal(device.deviceInfo, null);
});

test('verifyWriteAccess removes the probe file even when readback verification fails', async () => {
    const { device, root } = createDevice();
    device.readFile = async () => 'different contents';

    await assert.rejects(
        () => device.verifyWriteAccess(),
        /The write probe could not be read back from the Kobo drive/
    );

    assert.equal(await device.pathExists(['.kobopatch-webui-probe']), false);
    assert.deepEqual(root.removals, [
        { name: '.kobopatch-webui-probe', options: {} },
    ]);
});

test('connect skips the write probe for incompatible firmware', async () => {
    const root = new MockDirectoryHandle('root');
    await root.addFile([
        '.kobo',
        'version',
    ], 'N4280A0000000,4.9.77,5.0.0,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390');
    window.showDirectoryPicker = async () => root;

    const device = new KoboDevice();
    const info = await device.connect();

    assert.equal(info.isIncompatible, true);
    assert.equal(root.children.has('.kobopatch-webui-probe'), false);
});

test('writeFile creates nested directories and writes bytes to the target file', async () => {
    const { device, root } = createDevice();
    const payload = bytes('tgz payload');

    await device.writeFile(['.kobo', 'KoboRoot.tgz'], payload);

    const file = await getFile(root, ['.kobo', 'KoboRoot.tgz']);
    assert.equal(text(file.data), 'tgz payload');
    assert.equal(file.writes.length, 1);
});

test('writeFile rejects invalid path segments before calling the filesystem API', async () => {
    const { device, root } = createDevice();

    await assert.rejects(
        () => device.writeFile(['.adds', 'nm', ''], bytes('bad')),
        /Invalid device path for write: \.adds\/nm\/ \(path segments cannot be empty\)/
    );
    assert.equal(root.children.has('.adds'), false);
});

test('writeFile adds target path context to filesystem API failures', async () => {
    const { device, root } = createDevice();
    const nmDir = await root.addDirectory(['.adds', 'nm']);
    nmDir.getFileHandle = async () => {
        throw domError('TypeError', 'Name is not allowed');
    };

    await assert.rejects(
        () => device.writeFile(['.adds', 'nm', 'webui-preset'], bytes('items')),
        (err) => {
            assert.match(
                err.message,
                /Could not write \.adds\/nm\/webui-preset while opening or creating the target file: Name is not allowed/
            );
            assert.equal(err.cause.name, 'TypeError');
            assert.equal(err.devicePhase, 'opening or creating the target file');
            return true;
        }
    );
});

test('writeFile identifies commit failures separately from data writes', async () => {
    const { device, root } = createDevice();
    const target = await root.addFile(['.kobo', 'KoboRoot.tgz'], '');
    target.createWritable = async () => ({
        async write() {},
        async close() {
            throw domError(
                'NotFoundError',
                'A requested file or directory could not be found at the time an operation was processed'
            );
        },
    });

    await assert.rejects(
        () => device.writeFile(['.kobo', 'KoboRoot.tgz'], bytes('tgz')),
        (err) => {
            assert.match(
                err.message,
                /Could not write \.kobo\/KoboRoot\.tgz while committing the write: A requested file or directory/
            );
            assert.equal(err.cause.name, 'NotFoundError');
            assert.equal(err.devicePath, '.kobo/KoboRoot.tgz');
            assert.equal(err.deviceOperation, 'write');
            assert.equal(err.deviceWrite, true);
            assert.equal(err.devicePhase, 'committing the write');
            return true;
        }
    );
});

test('removeEntry removes a non-recursive entry directly', async () => {
    const { device, root } = createDevice();
    await root.addFile(['.adds', 'nm', 'items'], 'items');
    const nmDir = await getDirectory(root, ['.adds', 'nm']);

    await device.removeEntry(['.adds', 'nm', 'items']);

    assert.equal(await device.pathExists(['.adds', 'nm', 'items']), false);
    assert.deepEqual(nmDir.removals, [
        { name: 'items', options: {} },
    ]);
});

test('removeEntry deletes a directory tree one entry at a time, never using the native recursive flag', async () => {
    const { device, root } = createDevice();
    await root.addFile(['.adds', 'koreader', 'koreader.sh'], 'sh');
    await root.addFile(['.adds', 'koreader', 'data', 'fonts', 'noto.ttf'], 'font');
    await root.addFile(['.adds', 'koreader', 'data', 'l10n', 'fr.po'], 'l10n');

    // Fail loudly if anything ever asks for a native recursive removal — the
    // whole point is to delete entries one-by-one.
    const reject = handle => {
        const native = handle.removeEntry.bind(handle);
        handle.removeEntry = async (name, options = {}) => {
            assert.ok(!options.recursive, `unexpected recursive removeEntry on ${name}`);
            return native(name, options);
        };
        for (const child of handle.children.values()) {
            if (child.kind === 'directory') reject(child);
        }
    };
    reject(root);

    await device.removeEntry(['.adds', 'koreader'], { recursive: true });

    assert.equal(await device.pathExists(['.adds', 'koreader']), false);
});

test('removeEntry tolerates a descendant that disappears mid-walk (NotFoundError)', async () => {
    const { device, root } = createDevice();
    await root.addFile(['.adds', 'koreader', 'koreader.sh'], 'sh');
    await root.addFile(['.adds', 'koreader', 'cache.dat'], 'cache');
    const koDir = await getDirectory(root, ['.adds', 'koreader']);

    // An entry vanishes out from under us between enumeration and deletion:
    // removeEntry('cache.dat') reports NotFoundError, as if already gone.
    const native = koDir.removeEntry.bind(koDir);
    koDir.removeEntry = async (name, options = {}) => {
        if (name === 'cache.dat') {
            koDir.children.delete(name);
            throw domError('NotFoundError', 'A requested file or directory could not be found.');
        }
        return native(name, options);
    };

    await device.removeEntry(['.adds', 'koreader'], { recursive: true });

    assert.equal(await device.pathExists(['.adds', 'koreader']), false);
});

test('removeEntry treats an already-missing directory as a successful removal', async () => {
    const { device, root } = createDevice();
    await root.addDirectory(['.adds']);

    await assert.doesNotReject(
        device.removeEntry(['.adds', 'koreader'], { recursive: true }),
    );
});

test('collectExistingEntries reads files and recursively collects directories', async () => {
    const { device, root } = createDevice();
    await root.addFile(['.kobo', 'Kobo', 'Kobo eReader.conf'], 'conf');
    await root.addFile(['.adds', 'nm', 'items'], 'items');
    await root.addFile(['.adds', 'nm', 'icons', 'cog.png'], 'icon');
    const progress = [];

    const entries = await device.collectExistingEntries([
        ['.kobo', 'Kobo', 'Kobo eReader.conf'],
        ['.adds', 'nm'],
        ['missing', 'file.txt'],
    ], message => progress.push(message));

    assert.deepEqual(entries.map(entry => entry.path), [
        '.kobo/Kobo/Kobo eReader.conf',
        '.adds/nm/items',
        '.adds/nm/icons/cog.png',
    ]);
    assert.deepEqual(entries.map(entry => text(entry.data)), ['conf', 'items', 'icon']);
    assert.deepEqual(progress.map(message => message.path), [
        '.kobo/Kobo/Kobo eReader.conf',
        '.adds/nm/items',
        '.adds/nm/icons/cog.png',
    ]);
});

test('readFile and pathExists return null or false for missing paths without creating directories', async () => {
    const { device, root } = createDevice();

    assert.equal(await device.readFile(['.kobo', 'missing.conf']), null);
    assert.equal(await device.pathExists(['.kobo', 'missing.conf']), false);
    assert.equal(root.children.has('.kobo'), false);
});
