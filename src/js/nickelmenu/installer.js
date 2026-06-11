import JSZip from 'jszip';
import { fetchOrThrow } from '../shell/dom.js';
import {
    removeExcludeSyncFoldersLine,
    setConfSetting,
    setExcludeSyncFoldersLine,
} from '../kobo/configuration.js';

import customMenu from './features/custom-menu/index.js';
import additionalFonts from './features/additional-fonts/index.js';
import betterTypography from './features/better-typography/index.js';
import koreader from './features/koreader/index.js';
import simplifyTabs from './features/simplify-tabs/index.js';
import { homeHiders } from './features/hide-home-content/index.js';
import screensaver from './features/screensaver/index.js';
import excludeCalibre from './features/exclude-calibre/index.js';
import sideloadedMode from './features/sideloaded-mode/index.js';
import {
    buildExcludeSyncFoldersLine,
    legacyBrokenExcludeSyncFoldersLines,
} from '../kobo/sync-exclusions.js';

export function getExcludeSyncFoldersLine(features = []) {
    return buildExcludeSyncFoldersLine({
        excludeCalibre: features.some(f => f.id === excludeCalibre.id),
    });
}

/**
 * All available NickelMenu features in display order.
 * Features with `required: true` are always included in the preset.
 * Features with `postProcess` modify files produced by other features.
 */
export const NICKELMENU_FEATURES = [
    customMenu,
    simplifyTabs,
    ...homeHiders,
    additionalFonts,
    betterTypography,
    koreader,
    // "Advanced" section — less common power-user options, rendered last and
    // collapsed by default in the feature selection step.
    sideloadedMode,
    screensaver,
    excludeCalibre,
];

/**
 * Create the context passed to a feature's installer-time hooks (`install` and
 * `postProcess`). Every hook receives `deviceInfo` and the selected `features`
 * so features can adapt to the connected hardware and to what else is being
 * installed; installer-time hooks additionally get `asset` and `progress`.
 * Assets are fetched at runtime from the feature's directory under
 * /js/nickelmenu/features/<id>/.
 */
function createContext(feature, progressFn, deviceInfo = null, features = []) {
    const basePath = `js/nickelmenu/features/${feature.id}/`;
    return {
        async asset(relativePath) {
            const url = basePath + relativePath;
            const resp = await fetchOrThrow(url, `Failed to load asset ${url}`);
            return new Uint8Array(await resp.arrayBuffer());
        },
        progress(msg) {
            progressFn(msg);
        },
        deviceInfo,
        features,
    };
}

/**
 * Assemble the NickelMenu `.adds/nm/items` file from the selected features'
 * `menuItems` hooks. Each feature contributes ordered entries
 * (`{ id, order, lines }`); they are sorted by `order` and rendered (entries
 * separated by a blank line, trailing newline). Returns null when no feature
 * contributes any entries (e.g. nothing that ships the Tweak menu is selected).
 */
function buildItemsFile(features, deviceInfo) {
    const menuCtx = { deviceInfo, features };
    const entries = [];
    const seenIds = new Set();
    for (const feature of features) {
        if (!feature.menuItems) continue;
        for (const entry of feature.menuItems(menuCtx)) {
            // Several features can contribute the same shared entry — e.g. every
            // home-content hider offers the one "Show/hide home content" toggle.
            // Keep the first; the duplicates are identical.
            if (seenIds.has(entry.id)) continue;
            seenIds.add(entry.id);
            entries.push(entry);
        }
    }
    if (entries.length === 0) return null;

    entries.sort((a, b) => a.order - b.order);
    return entries.map(entry => entry.lines.join('\n')).join('\n\n') + '\n';
}

/**
 * Best-effort write of the on-device audit log. Logging must never fail an
 * install or removal, so write errors are logged and swallowed.
 */
export async function writeAuditLog(audit, device, logger = console) {
    if (!audit) return;
    try {
        await audit.write(device);
    } catch (err) {
        logger.warn('Could not write audit log:', err);
    }
}

export class NickelMenuInstaller {
    constructor() {
        this.nickelMenuZip = null;
    }

    /**
     * Download and cache NickelMenu.zip (contains KoboRoot.tgz).
     */
    async loadNickelMenu(progressFn) {
        if (this.nickelMenuZip) return;
        progressFn('Downloading NickelMenu...');
        const resp = await fetchOrThrow('assets/NickelMenu.zip', 'Failed to download NickelMenu.zip');
        this.nickelMenuZip = await JSZip.loadAsync(await resp.arrayBuffer());
    }

    /**
     * Get KoboRoot.tgz from the NickelMenu zip.
     */
    async getKoboRootTgz() {
        const file = this.nickelMenuZip.file('KoboRoot.tgz');
        if (!file) throw new Error('KoboRoot.tgz not found in NickelMenu.zip');
        return new Uint8Array(await file.async('arraybuffer'));
    }

    /**
     * Run selected features and collect all files to write.
     * @param {object[]} features - feature modules to run
     * @param {function} progressFn
     * @returns {{ path: string, data: Uint8Array|string }[]}
     */
    async collectFiles(features, progressFn, deviceInfo = null) {
        let files = [];

        // Run install() for features that have it
        for (const feature of features) {
            if (!feature.install) continue;
            const ctx = createContext(feature, progressFn, deviceInfo, features);
            progressFn(`Setting up ${feature.title}...`);
            const result = await feature.install(ctx);
            files.push(...result);
        }

        // De-duplicate shared install files by path — e.g. several home-content
        // hiders each ship the identical toggle script. Keep the first write.
        const seenPaths = new Set();
        files = files.filter(file => {
            if (seenPaths.has(file.path)) return false;
            seenPaths.add(file.path);
            return true;
        });

        // Assemble the NickelMenu items file from the features' menuItems hooks.
        // It is built as a string so postProcess features can still mutate it.
        const itemsContent = buildItemsFile(features, deviceInfo);
        if (itemsContent !== null) {
            files.push({ path: '.adds/nm/items', data: itemsContent });
        }

        // Run postProcess() for features that have it. These mutate the assembled
        // items string in place (simplify-tabs prepends tab config, the hide-*
        // features append flags, sideloaded comments out the home-tab override).
        const itemsFile = files.find(f => f.path === '.adds/nm/items');
        for (const feature of features) {
            if (!feature.postProcess) continue;
            const ctx = createContext(feature, progressFn, deviceInfo, features);
            files = feature.postProcess(files, ctx);
        }

        // Encode the items file to bytes for writing.
        if (itemsFile && typeof itemsFile.data === 'string') {
            itemsFile.data = new TextEncoder().encode(itemsFile.data);
        }

        return files;
    }

    /**
     * Install to a connected Kobo device via File System Access API.
     */
    async installToDevice(device, features, progressFn, { audit = null } = {}) {
        await this.loadNickelMenu(progressFn);

        progressFn('Writing KoboRoot.tgz...');
        const tgz = await this.getKoboRootTgz();
        await device.writeFile(['.kobo', 'KoboRoot.tgz'], tgz);
        audit?.record(`Installed NickelMenu: wrote .kobo/KoboRoot.tgz (${tgz.length} bytes)`);

        if (features.length > 0) {
            // Features may require the ignore block in the config, write it first
            progressFn('Updating Kobo eReader.conf...');
            await this.updateEReaderConf(device, features, audit);

            // After that, collect all practical files that need to be copied
            const files = await this.collectFiles(features, progressFn, device.deviceInfo);
            progressFn('Writing files to Kobo...');

            const totalFiles = files.length;
            for (let i = 0; i < files.length; i++) {
                const { path, data } = files[i];
                const pathArray = path.split('/');
                const fileData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                await device.writeFile(pathArray, fileData);
                audit?.record(`Wrote ${path} (${fileData.length} bytes)`);
                progressFn(`Writing files to Kobo (${i + 1} of ${totalFiles})...`);
            }
        }

        await writeAuditLog(audit, device);
        progressFn('Done.');
    }

    /**
     * Build a zip for manual download.
     */
    async buildDownloadZip(features, progressFn, deviceInfo = null) {
        await this.loadNickelMenu(progressFn);

        progressFn('Building download package...');
        const zip = new JSZip();

        const tgz = await this.getKoboRootTgz();
        zip.file('.kobo/KoboRoot.tgz', tgz);

        if (features.length > 0) {
            const files = await this.collectFiles(features, progressFn, deviceInfo);
            for (const { path, data } of files) {
                const fileData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                zip.file(path, fileData);
            }
        }

        progressFn('Compressing...');
        const result = await zip.generateAsync({ type: 'uint8array' });
        progressFn('Done.');
        return result;
    }

    /**
     * Add or update ExcludeSyncFolders in Kobo eReader.conf.
     * @param {object[]} features - selected features; if 'exclude-calibre' is included, the calibre folder is excluded.
     */
    async updateEReaderConf(device, features = [], audit = null) {
        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        const settingLine = getExcludeSyncFoldersLine(features);
        let content = setExcludeSyncFoldersLine(
            await device.readFile(confPath) || '',
            settingLine
        );
        audit?.record(`Set Kobo eReader.conf ExcludeSyncFolders=${settingLine}`);

        // Apply any Kobo eReader.conf settings declared by selected features
        // (e.g. better-typography's reading/rendering preferences). Features pass
        // the full selection so they can adapt (e.g. only set a default font when
        // the fonts are also being installed).
        const settingsCtx = { deviceInfo: device.deviceInfo, features };
        for (const feature of features) {
            if (!feature.confSettings) continue;
            for (const { section, key, value } of feature.confSettings(settingsCtx)) {
                content = setConfSetting(content, section, key, value);
                audit?.record(`Set Kobo eReader.conf [${section}] ${key}=${value}`);
            }
        }

        await device.writeFile(confPath, new TextEncoder().encode(content));
    }

    /**
     * Remove ExcludeSyncFolders from Kobo eReader.conf.
     */
    async removeExcludeSyncFolders(device) {
        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        const content = await device.readFile(confPath);
        if (!content || !content.includes('ExcludeSyncFolders')) return;

        const updated = removeExcludeSyncFoldersLine(content);
        if (updated !== content) {
            await device.writeFile(confPath, new TextEncoder().encode(updated));
        }
    }

    /**
     * Replace legacy malformed ExcludeSyncFolders values with the default
     * generated line when uninstall keeps sync exclusions in place.
     */
    async repairLegacyExcludeSyncFolders(device) {
        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        const content = await device.readFile(confPath);
        if (!content || !content.includes('ExcludeSyncFolders')) return;

        let updated = content;
        for (const line of Object.values(legacyBrokenExcludeSyncFoldersLines)) {
            if (!updated.includes(line)) continue;
            updated = setExcludeSyncFoldersLine(updated, buildExcludeSyncFoldersLine());
        }

        if (updated !== content) {
            await device.writeFile(confPath, new TextEncoder().encode(updated));
        }
    }
}
