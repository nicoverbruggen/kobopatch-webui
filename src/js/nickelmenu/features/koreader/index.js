import JSZip from 'jszip';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableVersion, installableAssetUrl, installableSize } from '../../installables.js';

// Installs KOReader, an alternative e-book reader, alongside the built-in Kobo
// reader (it does not replace it). The app is downloaded as a release zip at
// install time and extracted into .adds/koreader/, and a Toggle-menu item is
// added to launch it. Removal deletes the whole app directory.
export default {
    id: 'koreader',
    subFeaturesLabel: 'Plugins', // what its add-ons are called in the feature list
    section: 'Alternative reading apps',
    analyticsEvent: 'add-koreader',
    title: 'Install KOReader',
    description: 'Installs KOReader, an alternative e-book reader with advanced features like PDF reflow, customizable fonts, and more.',
    default: false,
    available: false, // set to true at runtime if KOReader assets exist
    directories: ['.adds/koreader'],
    hint: 'https://github.com/koreader/koreader',

    reviewNotices() {
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
        const version = installableVersion('koreader');
        if (!version) throw new Error('KOReader assets not available (run npm run setup:installables)');

        const label = 'Downloading KOReader ' + version + '...';
        ctx.progress(label);
        const zipBytes = await fetchWithProgress(
            installableAssetUrl('koreader', 'koreader-kobo.zip'),
            downloadProgress(ctx.progress, label, await installableSize('koreader')),
            'Failed to download KOReader',
        );
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
