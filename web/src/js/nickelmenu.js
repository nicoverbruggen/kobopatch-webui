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
 *   koreader: bool       — download and install latest KOReader from GitHub
 */
class NickelMenuInstaller {
    constructor() {
        this.nickelMenuZip = null;  // JSZip instance
        this.koboConfigZip = null;  // JSZip instance
        this.koreaderZip = null;    // JSZip instance
    }

    /**
     * Download and cache the bundled assets.
     * @param {function} progressFn
     * @param {boolean} [needConfig=true] - Whether to also load kobo-config.zip
     */
    async loadAssets(progressFn, needConfig = true) {
        if (!this.nickelMenuZip) {
            progressFn('Downloading NickelMenu...');
            const nmResp = await fetch('nickelmenu/NickelMenu.zip');
            if (!nmResp.ok) throw new Error('Failed to download NickelMenu.zip: HTTP ' + nmResp.status);
            this.nickelMenuZip = await JSZip.loadAsync(await nmResp.arrayBuffer());
        }

        if (needConfig && !this.koboConfigZip) {
            progressFn('Downloading configuration files...');
            const cfgResp = await fetch('nickelmenu/kobo-config.zip');
            if (!cfgResp.ok) throw new Error('Failed to download kobo-config.zip: HTTP ' + cfgResp.status);
            this.koboConfigZip = await JSZip.loadAsync(await cfgResp.arrayBuffer());
        }
    }

    /**
     * Download and cache KOReader for Kobo (served from the app's own domain
     * to avoid CORS issues with GitHub release downloads).
     * @param {function} progressFn
     */
    async loadKoreader(progressFn) {
        if (this.koreaderZip) return;

        progressFn('Fetching KOReader release info...');
        const metaResp = await fetch('/koreader/release.json');
        if (!metaResp.ok) throw new Error('KOReader assets not available (run koreader/setup.sh)');
        const meta = await metaResp.json();

        progressFn('Downloading KOReader ' + meta.version + '...');
        const zipResp = await fetch('/koreader/koreader-kobo.zip');
        if (!zipResp.ok) throw new Error('Failed to download KOReader: HTTP ' + zipResp.status);
        this.koreaderZip = await JSZip.loadAsync(await zipResp.arrayBuffer());
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
     * Get KOReader files from the downloaded zip, remapped to .adds/koreader/.
     * The zip contains a top-level koreader/ directory that needs to be placed
     * under .adds/ on the device. Also includes a NickelMenu launcher config.
     * Returns { path: string[], data: Uint8Array } entries.
     */
    async getKoreaderFiles() {
        const files = [];
        for (const [relativePath, zipEntry] of Object.entries(this.koreaderZip.files)) {
            if (zipEntry.dir) continue;
            // Remap koreader/... to .adds/koreader/...
            const devicePath = relativePath.startsWith('koreader/')
                ? '.adds/' + relativePath
                : '.adds/koreader/' + relativePath;
            const data = new Uint8Array(await zipEntry.async('arraybuffer'));
            files.push({
                path: devicePath.split('/'),
                data,
            });
        }

        // Add NickelMenu launcher config
        const launcherConfig = 'menu_item:main:KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh\n';
        files.push({
            path: ['.adds', 'nm', 'koreader'],
            data: new TextEncoder().encode(launcherConfig),
        });

        return files;
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
        const needConfig = option !== 'nickelmenu-only';
        await this.loadAssets(progressFn, needConfig);

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

        // Install KOReader if selected
        if (cfg.koreader) {
            await this.loadKoreader(progressFn);
            progressFn('Writing KOReader files...');
            const koreaderFiles = await this.getKoreaderFiles();
            for (const { path, data } of koreaderFiles) {
                await device.writeFile(path, data);
            }
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
        const needConfig = option !== 'nickelmenu-only';
        await this.loadAssets(progressFn, needConfig);

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

            // Include KOReader if selected
            if (cfg.koreader) {
                await this.loadKoreader(progressFn);
                progressFn('Adding KOReader to package...');
                const koreaderFiles = await this.getKoreaderFiles();
                for (const { path, data } of koreaderFiles) {
                    zip.file(path.join('/'), data);
                }
            }
        }

        progressFn('Compressing...');
        const result = await zip.generateAsync({ type: 'uint8array' });
        progressFn('Done.');
        return result;
    }
}

export { NickelMenuInstaller };
