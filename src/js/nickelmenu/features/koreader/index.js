import JSZip from 'jszip';
import { firmwareMajor } from '../../../kobo/version.js';
import { downloadProgress } from '../../../shell/dom.js';
import { installableAvailable, installableVersion, installableSize, fetchInstallableAsset } from '../../installables.js';

const os6ExitPatch = new URL('./2-webui-os6-exit.lua', import.meta.url);

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

    reviewNotices({ deviceInfo } = {}) {
        if (firmwareMajor(deviceInfo?.firmware) === 6) {
            return [
                {
                    type: 'warning',
                    title: 'Exiting KOReader on Kobo OS 6',
                    paragraphs: [
                        'Returning from KOReader to Kobo can get stuck on the startup screen. This installation hides the normal Exit action and its long-press shortcut. Use Exit → Reboot the device instead. If your Kobo gets stuck, hold the power button until it shuts down, then press it again to turn it on. Keep the included KOReader user patch enabled.',
                    ],
                },
            ];
        }
        return [
            {
                type: 'warning',
                title: 'Known issue with KOReader',
                paragraphs: [
                    "KOReader has a known issue where exiting while Bluetooth is enabled may cause NickelMenu to uninstall itself. Use KOReader's reboot option instead, or turn Bluetooth off before starting KOReader.",
                ],
                link: {
                    label: 'GitHub issue',
                    href: 'https://github.com/koreader/koreader/issues/12739',
                },
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

        if (firmwareMajor(ctx.deviceInfo?.firmware) === 6) {
            files.push({ path: '.adds/koreader/patches/2-webui-os6-exit.lua', data: await ctx.bundledAsset(os6ExitPatch) });
        }
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
