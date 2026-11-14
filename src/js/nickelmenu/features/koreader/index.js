import JSZip from 'jszip';
import { firmwareMajor } from '../../../kobo/version.js';
import { downloadProgress } from '../../../shell/dom.js';
import { installableAvailable, installableVersion, installableSize, fetchInstallableAsset } from '../../installables.js';

const exitRebootPatch = new URL('./2-webui-os6-exit.lua', import.meta.url);

function readerPackage(deviceInfo) {
    return firmwareMajor(deviceInfo?.firmware) === 6 ? { id: 'koreader-kobov5', asset: 'koreader-kobov5.zip' } : { id: 'koreader', asset: 'koreader-kobo.zip' };
}

// Installs KOReader, an alternative e-book reader, alongside the built-in Kobo
// reader (it does not replace it). The app is downloaded as a release zip at
// install time and extracted into .adds/koreader/, and a Toggle-menu item is
// added to launch it. Removal deletes the whole app directory.
export default {
    supportedFirmwareMajors: [4, 6],
    id: 'koreader',
    subFeaturesLabel: 'Plugins', // what its add-ons are called in the feature list
    section: 'Alternative reading apps',
    analyticsEvent: 'add-koreader',
    title: 'Install KOReader',
    description: 'Installs KOReader, an alternative e-book reader with advanced features like PDF reflow, customizable fonts, and more.',
    default: false,
    available: (deviceInfo) => installableAvailable(readerPackage(deviceInfo).id),
    version: (deviceInfo) => installableVersion(readerPackage(deviceInfo).id),
    directories: ['.adds/koreader'],
    hint: 'https://github.com/koreader/koreader',

    // KOReader's own updater rewrites this file, so it is what is actually on the
    // device — the manifest only records what this tool last wrote.
    async installedVersion(device) {
        const rev = await device.readFile(['.adds', 'koreader', 'git-rev']);
        return rev?.trim() || null;
    },

    reviewNotices() {
        return [
            {
                type: 'warning',
                title: 'Exiting KOReader restarts your Kobo',
                paragraphs: [
                    'Choosing Exit in KOReader will ask to restart your Kobo. This avoids problems when returning directly to Kobo’s reader, including hangs or disabled mods. Keep the included KOReader user patch enabled.',
                ],
            },
        ];
    },

    cleanup: {
        mode: 'optional',
        title: 'KOReader',
        removeLabel: 'Remove the KOReader app (.adds/koreader)',
        description: 'Removes the KOReader app directory (.adds/koreader/), and with it any plugins installed inside it.',
        detect: [['.adds', 'koreader']],
        paths: [{ path: ['.adds', 'koreader'], recursive: true }],
    },

    async install(ctx) {
        const pkg = readerPackage(ctx.deviceInfo);
        const version = installableVersion(pkg.id);
        if (!version || !installableAvailable(pkg.id)) throw new Error('KOReader assets not available (run npm run setup:installables)');

        const label = 'Downloading KOReader ' + version + '...';
        ctx.progress(label);
        const zipBytes = await fetchInstallableAsset(pkg.id, pkg.asset, {
            onProgress: downloadProgress(ctx.progress, label, await installableSize(pkg.id)),
            errorPrefix: 'Failed to download KOReader',
        });
        const zip = await JSZip.loadAsync(zipBytes);

        ctx.progress('Extracting KOReader...');
        const files = [];
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            const devicePath = relativePath.startsWith('koreader/') ? '.adds/' + relativePath : '.adds/koreader/' + relativePath;
            files.push({
                path: devicePath,
                data: new Uint8Array(await entry.async('arraybuffer')),
            });
        }

        files.push({ path: '.adds/koreader/patches/2-webui-os6-exit.lua', data: await ctx.bundledAsset(exitRebootPatch) });
        return files;
    },

    menuItems() {
        // The Toggle-menu entry that launches KOReader. Its position (just below
        // the Toggle tab header) is set by 'koreader' in ../menu-order.js.
        return [
            {
                id: 'koreader',
                lines: ['menu_item:main:KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh'],
            },
        ];
    },
};
