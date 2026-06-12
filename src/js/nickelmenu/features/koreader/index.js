import JSZip from 'jszip';

// Installs KOReader, an alternative e-book reader, alongside the built-in Kobo
// reader (it does not replace it). The app is downloaded as a release zip at
// install time and extracted into .adds/koreader/, and a Toggle-menu item is
// added to launch it. Removal deletes the whole app directory.
export default {
    id: 'koreader',
    section: 'Reading Apps',
    title: 'Install KOReader',
    description: 'Installs KOReader, an alternative e-book reader with advanced features like PDF reflow, customizable fonts, and more. You can launch KOReader from the Toggle menu; it does not replace the built-in reader functionality. Installing takes a while, please be patient.',
    default: false,
    available: false, // set to true at runtime if KOReader assets exist
    directories: ['.adds/koreader'],

    reviewNotices() {
        return [
            {
                type: 'warning',
                title: 'Known issue with KOReader',
                paragraphs: [
                    'KOReader has a known issue where exiting while Bluetooth is enabled may cause NickelMenu to uninstall itself. Use KOReader\'s reboot option instead, or turn Bluetooth off before starting KOReader.',
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
        description: 'Removes the KOReader app directory (.adds/koreader/).',
        detect: [['.adds', 'koreader']],
        paths: [
            { path: ['.adds', 'koreader'], recursive: true },
        ],
    },

    async install(ctx) {
        ctx.progress('Fetching KOReader release info...');
        const metaResp = await fetch('/assets/koreader-release.json');
        if (!metaResp.ok) throw new Error('KOReader assets not available (run npm run setup:installables)');
        const meta = await metaResp.json();

        ctx.progress('Downloading KOReader ' + meta.version + '...');
        const zipResp = await fetch('/assets/koreader-kobo.zip');
        if (!zipResp.ok) throw new Error('Failed to download KOReader: HTTP ' + zipResp.status);
        const zip = await JSZip.loadAsync(await zipResp.arrayBuffer());

        ctx.progress('Extracting KOReader...');
        const files = [];
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            const devicePath = relativePath.startsWith('koreader/')
                ? '.adds/' + relativePath
                : '.adds/koreader/' + relativePath;
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
        return [{
            id: 'koreader',
            lines: ['menu_item:main:Open KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh'],
        }];
    },
};
