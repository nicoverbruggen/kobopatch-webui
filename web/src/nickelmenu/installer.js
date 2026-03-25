import JSZip from 'jszip';
import { fetchOrThrow } from '../js/dom.js';

import customMenu from './features/custom-menu/index.js';
import readerlyFonts from './features/readerly-fonts/index.js';
import koreader from './features/koreader/index.js';
import simplifyTabs from './features/simplify-tabs/index.js';
import hideRecommendations from './features/hide-recommendations/index.js';
import hideNotices from './features/hide-notices/index.js';
import screensaver from './features/screensaver/index.js';

/**
 * All available NickelMenu features in display order.
 * Features with `required: true` are always included in the preset.
 * Features with `postProcess` modify files produced by other features.
 */
export const ALL_FEATURES = [
    customMenu,
    readerlyFonts,
    simplifyTabs,
    hideRecommendations,
    hideNotices,
    koreader,
    screensaver,
];

/**
 * Create an asset-loading context for a given feature.
 * Assets are fetched at runtime from the feature's directory under /nickelmenu/features/<id>/.
 */
function createContext(feature, progressFn) {
    const basePath = `nickelmenu/features/${feature.id}/`;
    return {
        async asset(relativePath) {
            const url = basePath + relativePath;
            const resp = await fetchOrThrow(url, `Failed to load asset ${url}`);
            return new Uint8Array(await resp.arrayBuffer());
        },
        progress(msg) {
            progressFn(msg);
        },
    };
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
        const resp = await fetchOrThrow('nickelmenu/NickelMenu.zip', 'Failed to download NickelMenu.zip');
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
    async collectFiles(features, progressFn) {
        let files = [];

        // Run install() for features that have it
        for (const feature of features) {
            if (!feature.install) continue;
            const ctx = createContext(feature, progressFn);
            progressFn(`Setting up ${feature.title}...`);
            const result = await feature.install(ctx);
            files.push(...result);
        }

        // Decode binary items file to string for postProcess mutation
        const itemsFile = files.find(f => f.path === '.adds/nm/items');
        if (itemsFile && itemsFile.data instanceof Uint8Array) {
            itemsFile.data = new TextDecoder().decode(itemsFile.data);
        }

        // Run postProcess() for features that have it
        for (const feature of features) {
            if (!feature.postProcess) continue;
            files = feature.postProcess(files);
        }

        // Re-encode items file back to Uint8Array
        if (itemsFile && typeof itemsFile.data === 'string') {
            itemsFile.data = new TextEncoder().encode(itemsFile.data);
        }

        return files;
    }

    /**
     * Install to a connected Kobo device via File System Access API.
     */
    async installToDevice(device, features, progressFn) {
        await this.loadNickelMenu(progressFn);

        progressFn('Writing KoboRoot.tgz...');
        const tgz = await this.getKoboRootTgz();
        await device.writeFile(['.kobo', 'KoboRoot.tgz'], tgz);

        if (features.length > 0) {
            // Features require the ignore block in the config, write it first
            progressFn('Updating Kobo eReader.conf...');
            await this.updateEReaderConf(device);

            // After that, collect all practical files that need to be copied
            const files = await this.collectFiles(features, progressFn);
            progressFn('Writing files to Kobo...');

            const totalFiles = files.length;
            for (let i = 0; i < files.length; i++) {
                const { path, data } = files[i];
                const pathArray = path.split('/');
                const fileData = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                await device.writeFile(pathArray, fileData);
                progressFn(`Writing files to Kobo (${i + 1} of ${totalFiles})...`);
            }
        }

        progressFn('Done.');
    }

    /**
     * Build a zip for manual download.
     */
    async buildDownloadZip(features, progressFn) {
        await this.loadNickelMenu(progressFn);

        progressFn('Building download package...');
        const zip = new JSZip();

        const tgz = await this.getKoboRootTgz();
        zip.file('.kobo/KoboRoot.tgz', tgz);

        if (features.length > 0) {
            const files = await this.collectFiles(features, progressFn);
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
     * Add ExcludeSyncFolders to Kobo eReader.conf if not already present.
     */
    async updateEReaderConf(device) {
        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        let content = await device.readFile(confPath) || '';

        const settingLine = 'ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)';

        if (content.includes('ExcludeSyncFolders')) return;

        if (content.includes('[FeatureSettings]')) {
            content = content.replace(
                '[FeatureSettings]',
                '[FeatureSettings]\n' + settingLine
            );
        } else {
            content += '\n[FeatureSettings]\n' + settingLine + '\n';
        }

        await device.writeFile(confPath, new TextEncoder().encode(content));
    }
}
