const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE = String.raw`ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)`;

// Real (tiny) KoboReader.sqlite fixtures so sign-in detection — which parses the
// actual SQLite b-tree — has genuine bytes to read. signed-in has one `user`
// row; factory-reset has zero.
const SIGNIN_FIXTURES = {
    true: path.join(__dirname, 'fixtures', 'kobo-reader-signed-in.sqlite'),
    false: path.join(__dirname, 'fixtures', 'kobo-reader-factory-reset.sqlite'),
};

// A real Kobo eReader.conf ships a [Reading] section with these keys present but
// empty. Including them lets tests verify that Better typography and fixes and Additional
// Fonts update only the settings they own.
const READING_DEFAULTS = '[Reading]\nreadingAlignment=\nreadingFontFamily=\n';

/**
 * Inject a mock File System Access API into the page, simulating a Kobo Libra Color.
 * The mock provides:
 *   - .kobo/version file with serial N4280A0000000 and firmware 4.46.23836
 *   - Optionally a .adds/nm/ directory (to simulate NickelMenu being installed)
 *   - In-memory filesystem that tracks all writes for verification
 */
const defaultConfig = {
    firmware: '4.46.23836',
    serial: 'N4280A0000000',
    hardwareId: '00000000-0000-0000-0000-000000000390',
    hasNickelMenu: false,
    hasKOReader: false,
    hasNickelDbus: false,
    hasNickelSeries: false,
    hasNickelClock: false,
    hasCadmus: false,
    hasAdditionalFonts: false,
    hasScreensaver: false,
    hasCalibreExclude: false,
    eReaderConf: null,
    // The device UI language (CurrentLocale), e.g. 'en', 'fr', 'de'. Defaults to
    // 'en' so a connected device looks realistic; set null to omit the
    // [ApplicationPreferences] CurrentLocale entirely (locale unknown).
    uiLocale: 'en',
    extraAddsDirs: [],
    extraAddsFiles: [],
    // Files placed at arbitrary device-root paths, e.g.
    // { path: ['.kobopatch-webui', 'custom-patches.json'], content: '...' }.
    extraRootFiles: [],
    rootFolders: [],
    failReadPaths: [],
    failWritePaths: [],
    failRemovePaths: [],
    // null = leave the placeholder KoboReader.sqlite (sign-in unknown); true/false
    // swaps in a real fixture so detection reads a signed-in or factory-reset db.
    signedIn: null,
};

async function injectMockDevice(page, opts = {}) {
    const config = { ...defaultConfig, ...opts };
    // A real Kobo records its UI language as CurrentLocale in [ApplicationPreferences].
    // When a test sets uiLocale (and doesn't override the whole conf), prepend that
    // section so device language detection has something to read.
    const localeSection = config.uiLocale ? '[ApplicationPreferences]\nCurrentLocale=' + config.uiLocale + '\n' : '';
    config.eReaderConf =
        config.eReaderConf ??
        localeSection +
            (config.hasCalibreExclude
                ? '[General]\nsome=setting\n[FeatureSettings]\n' + EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE + '\n' + READING_DEFAULTS
                : '[General]\nsome=setting\n' + READING_DEFAULTS);

    // Load the matching KoboReader.sqlite fixture (as base64) when a sign-in state
    // is requested, so the in-page mock can expose its real bytes.
    if (config.signedIn === true || config.signedIn === false) {
        config.koboReaderSqliteBase64 = fs.readFileSync(SIGNIN_FIXTURES[config.signedIn]).toString('base64');
    }

    await page.evaluate((config) => {
        const file = (content = '') => ({ _type: 'file', content });
        const binaryFile = (bytes) => ({ _type: 'file', bytes });
        const dir = (children = {}) => ({ _type: 'dir', ...children });

        const filesystem = dir({
            '.kobo': dir({
                version: file(config.serial + ',4.9.77,' + config.firmware + ',4.9.77,4.9.77,' + config.hardwareId),
                'BookReader.sqlite': file('book-reader-db'),
                'device.salt.conf': file('salt=abc123'),
                'fonts.sqlite': file('fonts-db'),
                'KoboReader.sqlite': file('kobo-reader-db'),
                Kobo: dir({
                    'Kobo eReader.conf': file(config.eReaderConf),
                    'affiliate.conf': file('affiliate=test'),
                }),
                markups: dir({
                    'sample.annot': file('markup-data'),
                }),
            }),
        });

        if (config.hasNickelMenu) {
            filesystem['.adds'] = dir({
                nm: dir({ items: file('menu_item:main:test:skip:') }),
            });
        }

        if (config.hasKOReader) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds']['koreader'] = dir({ 'koreader.sh': file('#!/bin/sh') });
        }

        if (config.hasNickelDbus) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds']['nickeldbus'] = dir();
        }

        if (config.hasNickelSeries) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds']['nickelseries'] = dir();
        }

        if (config.hasNickelClock) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds']['nickelclock'] = dir();
        }

        if (config.hasCadmus) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds']['cadmus'] = dir({ 'cadmus.sh': file('#!/bin/sh') });
        }

        for (const folderName of config.extraAddsDirs) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            filesystem['.adds'][folderName] = dir();
        }

        for (const entry of config.extraAddsFiles) {
            if (!filesystem['.adds']) filesystem['.adds'] = dir();
            const parts = Array.isArray(entry) ? entry : entry.path;
            const content = Array.isArray(entry) ? '' : entry.content || '';
            let current = filesystem['.adds'];
            for (const part of parts.slice(0, -1)) {
                if (!current[part]) current[part] = dir();
                current = current[part];
            }
            current[parts[parts.length - 1]] = file(content);
        }

        if (config.hasAdditionalFonts) {
            filesystem['fonts'] = dir({
                'KF_Readerly-Regular.ttf': file(),
                'KF_Readerly-Italic.ttf': file(),
                'KF_Readerly-Bold.ttf': file(),
                'KF_Readerly-BoldItalic.ttf': file(),
                'KF_Libron-Regular.ttf': file(),
                'KF_Libron-Italic.ttf': file(),
                'KF_Libron-Bold.ttf': file(),
                'KF_Libron-BoldItalic.ttf': file(),
                'KF_Cartisse-Regular.ttf': file(),
                'KF_Cartisse-Italic.ttf': file(),
                'KF_Cartisse-Bold.ttf': file(),
                'KF_Cartisse-BoldItalic.ttf': file(),
            });
        }

        if (config.hasScreensaver) {
            if (!filesystem['.kobo']['screensaver']) {
                filesystem['.kobo']['screensaver'] = dir();
            }
            filesystem['.kobo']['screensaver']['moon.png'] = file();
        }

        for (const folderName of config.rootFolders) {
            filesystem[folderName] = dir();
        }

        for (const entry of config.extraRootFiles) {
            const parts = entry.path;
            let current = filesystem;
            for (const part of parts.slice(0, -1)) {
                if (!current[part]) current[part] = dir();
                current = current[part];
            }
            // A `base64` field seeds a genuine binary file (e.g. the patch-files
            // archive); otherwise the entry is plain text content.
            if (entry.base64 !== undefined) {
                const binary = atob(entry.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                current[parts[parts.length - 1]] = binaryFile(bytes);
            } else {
                current[parts[parts.length - 1]] = file(entry.content || '');
            }
        }

        // Swap the placeholder KoboReader.sqlite for a real fixture (decoded from
        // base64) so sign-in detection parses genuine SQLite bytes.
        if (config.koboReaderSqliteBase64) {
            const binary = atob(config.koboReaderSqliteBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            filesystem['.kobo']['KoboReader.sqlite'] = binaryFile(bytes);
        }

        window.__mockFS = filesystem;
        window.__mockWrittenFiles = {};
        window.__mockRemovedEntries = [];
        window.__mockFailReadPaths = new Set(config.failReadPaths || []);
        window.__mockFailWritePaths = new Set(config.failWritePaths || []);
        window.__mockFailRemovePaths = new Set(config.failRemovePaths || []);
        window.__mockEjected = false;

        function makeFileHandle(dirNode, fileName, pathPrefix) {
            const fullPath = pathPrefix ? pathPrefix + '/' + fileName : fileName;
            return {
                getFile: async () => {
                    const deviceRelativePath = fullPath.replace(/^KOBOeReader\//, '');
                    if (window.__mockFailReadPaths.has(fullPath) || window.__mockFailReadPaths.has(deviceRelativePath)) {
                        throw new DOMException('Read blocked: ' + fullPath, 'NotAllowedError');
                    }
                    const fileNode = dirNode[fileName];
                    // Binary nodes (e.g. the KoboReader.sqlite fixture) carry raw bytes;
                    // everything else stores text content. Normalise to bytes so the
                    // file-like exposes text/arrayBuffer/slice the same way a real Blob
                    // does — slice() backs KoboDevice.readFileRange's page reads.
                    const bytes = fileNode && fileNode.bytes ? fileNode.bytes : new TextEncoder().encode(fileNode ? fileNode.content || '' : '');
                    const arrayBufferOf = (sub) => sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength);
                    return {
                        text: async () => new TextDecoder().decode(bytes),
                        arrayBuffer: async () => arrayBufferOf(bytes),
                        slice: (start = 0, end = bytes.length) => ({
                            arrayBuffer: async () => arrayBufferOf(bytes.subarray(start, end)),
                        }),
                    };
                },
                createWritable: async () => {
                    const chunks = [];
                    return {
                        write: async (chunk) => {
                            chunks.push(chunk);
                        },
                        close: async () => {
                            if (window.__mockFailWritePaths.has(fullPath)) {
                                throw new TypeError('Name is not allowed');
                            }
                            const first = chunks[0];
                            const bytes = first instanceof Uint8Array ? first : new TextEncoder().encode(String(first));
                            if (!dirNode[fileName]) dirNode[fileName] = { _type: 'file' };
                            dirNode[fileName].content = new TextDecoder().decode(bytes);
                            window.__mockWrittenFiles[fullPath] = true;
                        },
                    };
                },
            };
        }

        function makeDirHandle(node, name, pathPrefix) {
            const currentPath = pathPrefix ? pathPrefix + '/' + name : name;
            return {
                name: name,
                kind: 'directory',
                getDirectoryHandle: async (childName, opts2) => {
                    if (window.__mockEjected) {
                        throw new DOMException('Not found: ' + childName, 'NotFoundError');
                    }
                    if (node[childName] && node[childName]._type === 'dir') {
                        return makeDirHandle(node[childName], childName, currentPath);
                    }
                    if (node[childName] && node[childName]._type === 'file') {
                        throw new DOMException('Not a directory: ' + childName, 'TypeMismatchError');
                    }
                    if (opts2 && opts2.create) {
                        node[childName] = { _type: 'dir' };
                        return makeDirHandle(node[childName], childName, currentPath);
                    }
                    throw new DOMException('Not found: ' + childName, 'NotFoundError');
                },
                getFileHandle: async (childName, opts2) => {
                    if (window.__mockEjected) {
                        throw new DOMException('Not found: ' + childName, 'NotFoundError');
                    }
                    if (node[childName] && node[childName]._type === 'file') {
                        return makeFileHandle(node, childName, currentPath);
                    }
                    if (node[childName] && node[childName]._type === 'dir') {
                        throw new DOMException('Not a file: ' + childName, 'TypeMismatchError');
                    }
                    if (opts2 && opts2.create) {
                        node[childName] = { _type: 'file', content: '' };
                        return makeFileHandle(node, childName, currentPath);
                    }
                    throw new DOMException('Not found: ' + childName, 'NotFoundError');
                },
                removeEntry: async (childName, opts2 = {}) => {
                    const fullPath = currentPath ? currentPath + '/' + childName : childName;
                    const deviceRelativePath = fullPath.replace(/^KOBOeReader\//, '');
                    if (window.__mockFailRemovePaths.has(fullPath) || window.__mockFailRemovePaths.has(deviceRelativePath)) {
                        throw new DOMException('Remove blocked: ' + fullPath, 'NoModificationAllowedError');
                    }
                    const child = node[childName];
                    if (child) {
                        if (child._type === 'dir' && !opts2.recursive) {
                            const childEntries = Object.keys(child).filter((name) => name !== '_type');
                            if (childEntries.length > 0) {
                                throw new DOMException('Directory not empty: ' + childName, 'InvalidModificationError');
                            }
                        }
                        window.__mockRemovedEntries.push({ path: fullPath, recursive: !!opts2.recursive });
                        delete node[childName];
                        return;
                    }
                    throw new DOMException('Not found: ' + childName, 'NotFoundError');
                },
                values: async function* () {
                    for (const [childName, childNode] of Object.entries(node)) {
                        if (childName === '_type') continue;
                        if (childNode && childNode._type === 'dir') {
                            yield makeDirHandle(childNode, childName, currentPath);
                        } else if (childNode && childNode._type === 'file') {
                            yield {
                                name: childName,
                                kind: 'file',
                            };
                        }
                    }
                },
            };
        }

        const rootHandle = makeDirHandle(filesystem, 'KOBOeReader', '');
        window.showDirectoryPicker = async () => rootHandle;
    }, config);
}

/**
 * Inject mock device, optionally override firmware URLs, and connect.
 */
async function connectMockDevice(page, opts = {}) {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('KoboPatch');
    await injectMockDevice(page, opts);
    if (opts.overrideFirmware) {
        await overrideFirmwareURLs(page);
    }
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#device-model')).toHaveText(opts.expectedModel ?? 'Kobo Libra Colour');
    await expect(page.locator('#device-firmware')).toHaveText(opts.firmware ?? '4.46.23836');
    await expect(page.locator('#device-status')).toContainText('recognized');
}

/**
 * Override firmware download URLs to point at the local test server.
 */
async function overrideFirmwareURLs(page) {
    await page.evaluate(() => {
        for (const version of Object.keys(FIRMWARE_DOWNLOADS)) {
            for (const prefix of Object.keys(FIRMWARE_DOWNLOADS[version])) {
                FIRMWARE_DOWNLOADS[version][prefix] = '/_test_firmware.zip';
            }
        }
    });
}

/**
 * Navigate to manual mode.
 */
async function goToManualMode(page) {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('KoboPatch');
    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
}

/**
 * Read a file's content from the mock filesystem.
 */
async function readMockFile(page, ...pathParts) {
    return page.evaluate((parts) => {
        let node = window.__mockFS;
        for (const part of parts) {
            if (!node || !node[part]) return null;
            node = node[part];
        }
        return node && node._type === 'file' ? node.content || '' : null;
    }, pathParts);
}

/**
 * Check whether a path exists in the mock filesystem.
 */
async function mockPathExists(page, ...pathParts) {
    return page.evaluate((parts) => {
        let node = window.__mockFS;
        for (const part of parts) {
            if (!node || !node[part]) return false;
            node = node[part];
        }
        return true;
    }, pathParts);
}

/**
 * Get the list of written file paths from the mock device.
 */
async function getWrittenFiles(page) {
    return page.evaluate(() => Object.keys(window.__mockWrittenFiles));
}

async function getRemovedEntries(page) {
    return page.evaluate(() => window.__mockRemovedEntries);
}

/**
 * Simulate the user ejecting (or unplugging) the Kobo: every handle lookup
 * starts failing, which is all the app can observe when a volume goes away.
 */
async function ejectMockDevice(page) {
    await page.evaluate(() => {
        window.__mockEjected = true;
    });
}

module.exports = {
    injectMockDevice,
    connectMockDevice,
    overrideFirmwareURLs,
    goToManualMode,
    readMockFile,
    mockPathExists,
    getWrittenFiles,
    getRemovedEntries,
    ejectMockDevice,
};
