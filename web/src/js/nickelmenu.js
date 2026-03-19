import JSZip from 'jszip';

/**
 * NickelMenu installer module.
 *
 * Handles downloading bundled NickelMenu + kobo-config assets,
 * and either writing them directly to a connected Kobo (auto mode)
 * or building a zip for manual download.
 *
 * Options:
 *   'nickelmenu-only'  — just NickelMenu (KoboRoot.tgz)
 *   'sample'           — NickelMenu + config based on cfg flags
 *
 * Config flags (when option is 'sample'):
 *   fonts: bool          — include Readerly fonts
 *   screensaver: bool    — include custom screensaver
 *   simplifyTabs: bool   — comment out experimental tab items in config
 *   simplifyHome: bool   — append homescreen simplification lines
 */
class NickelMenuInstaller {
    constructor() {
        this.nickelMenuZip = null;  // JSZip instance
        this.koboConfigZip = null;  // JSZip instance
    }

    /**
     * Download and cache the bundled assets.
     */
    async loadAssets(progressFn) {
        if (this.nickelMenuZip && this.koboConfigZip) return;

        progressFn('Downloading NickelMenu...');
        const nmResp = await fetch('nickelmenu/NickelMenu.zip');
        if (!nmResp.ok) throw new Error('Failed to download NickelMenu.zip: HTTP ' + nmResp.status);
        this.nickelMenuZip = await JSZip.loadAsync(await nmResp.arrayBuffer());

        progressFn('Downloading configuration files...');
        const cfgResp = await fetch('nickelmenu/kobo-config.zip');
        if (!cfgResp.ok) throw new Error('Failed to download kobo-config.zip: HTTP ' + cfgResp.status);
        this.koboConfigZip = await JSZip.loadAsync(await cfgResp.arrayBuffer());
    }

    /**
     * Get the KoboRoot.tgz from the NickelMenu zip.
     */
    async getKoboRootTgz() {
        const file = this.nickelMenuZip.file('KoboRoot.tgz');
        if (!file) throw new Error('KoboRoot.tgz not found in NickelMenu.zip');
        return new Uint8Array(await file.async('arraybuffer'));
    }

    /**
     * Get config files from kobo-config.zip filtered by cfg flags.
     * Returns { path: string[], data: Uint8Array } entries.
     */
    async getConfigFiles(cfg) {
        const files = [];

        for (const [relativePath, zipEntry] of Object.entries(this.koboConfigZip.files)) {
            if (zipEntry.dir) continue;

            // Filter by cfg flags
            if (relativePath.startsWith('fonts/') && !cfg.fonts) continue;
            if (relativePath.startsWith('.kobo/screensaver/') && !cfg.screensaver) continue;

            // Only include relevant directories
            if (!relativePath.startsWith('.adds/') &&
                !relativePath.startsWith('.kobo/screensaver/') &&
                !relativePath.startsWith('fonts/')) {
                continue;
            }

            let data = new Uint8Array(await zipEntry.async('arraybuffer'));

            // Modify the NickelMenu items file based on config
            if (relativePath === '.adds/nm/items') {
                let text = new TextDecoder().decode(data);

                // Comment out experimental lines at top if simplifyTabs is off
                if (!cfg.simplifyTabs) {
                    text = text.split('\n').map(line => {
                        if (line.startsWith('experimental:') && !line.startsWith('experimental:hide_home')) {
                            return '#' + line;
                        }
                        return line;
                    }).join('\n');
                }

                // Append homescreen simplification lines
                if (cfg.simplifyHome) {
                    text += '\nexperimental:hide_home_row1col2_enabled:1\nexperimental:hide_home_row3_enabled:1\n';
                }

                data = new TextEncoder().encode(text);
            }

            files.push({
                path: relativePath.split('/'),
                data,
            });
        }

        return files;
    }

    /**
     * Install to a connected Kobo device via File System Access API.
     * @param {KoboDevice} device
     * @param {string} option - 'sample' or 'nickelmenu-only'
     * @param {object|null} cfg - config flags (when option is 'sample')
     * @param {function} progressFn
     */
    async installToDevice(device, option, cfg, progressFn) {
        await this.loadAssets(progressFn);

        // Always install KoboRoot.tgz
        progressFn('Writing KoboRoot.tgz...');
        const tgz = await this.getKoboRootTgz();
        await device.writeFile(['.kobo', 'KoboRoot.tgz'], tgz);

        if (option === 'nickelmenu-only') {
            progressFn('Done.');
            return;
        }

        // Install config files
        progressFn('Writing configuration files...');
        const configFiles = await this.getConfigFiles(cfg);
        for (const { path, data } of configFiles) {
            await device.writeFile(path, data);
        }

        // Modify Kobo eReader.conf
        progressFn('Updating Kobo eReader.conf...');
        await this.updateEReaderConf(device);

        progressFn('Done.');
    }

    /**
     * Add ExcludeSyncFolders to Kobo eReader.conf if not already present.
     */
    async updateEReaderConf(device) {
        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        let content = await device.readFile(confPath) || '';

        const settingLine = 'ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)';

        if (content.includes('ExcludeSyncFolders')) {
            // Already has the setting, don't duplicate
            return;
        }

        // Add under [FeatureSettings], creating the section if needed
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

    /**
     * Build a zip for manual download containing all files to copy to the Kobo.
     * @param {string} option - 'sample' or 'nickelmenu-only'
     * @param {object|null} cfg - config flags (when option is 'sample')
     * @param {function} progressFn
     * @returns {Uint8Array} zip contents
     */
    async buildDownloadZip(option, cfg, progressFn) {
        await this.loadAssets(progressFn);

        progressFn('Building download package...');
        const zip = new JSZip();

        // Always include KoboRoot.tgz
        const tgz = await this.getKoboRootTgz();
        zip.file('.kobo/KoboRoot.tgz', tgz);

        if (option !== 'nickelmenu-only') {
            // Include config files
            const configFiles = await this.getConfigFiles(cfg);
            for (const { path, data } of configFiles) {
                zip.file(path.join('/'), data);
            }
        }

        progressFn('Compressing...');
        const result = await zip.generateAsync({ type: 'uint8array' });
        progressFn('Done.');
        return result;
    }
}

export { NickelMenuInstaller };
