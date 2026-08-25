import JSZip from 'jszip';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableVersion, installableAssetUrl, installableSize } from '../../installables.js';

// Installs SimpleUI, a KOReader plugin that adds a home screen, a navigation bar
// and a top status bar. It is not a standalone app: its files live inside
// KOReader's own plugins/ directory, which is why it declares `parent: 'koreader'`
// and is only offered when KOReader is being installed or already on the device.
// KOReader loads it on the next start; removal deletes the plugin directory and
// leaves KOReader itself alone.
export default {
    id: 'simpleui',
    parent: 'koreader',
    section: 'Alternative reading apps',
    analyticsEvent: 'add-simpleui',
    title: 'Simple UI', // as upstream names it; the row label adds "plugin"
    // One line: a plugin row is compact, and the "?" badge links to the full
    // description upstream.
    description: 'Home screen, navigation bar and reading stats.',
    default: false,
    available: false, // set to true at runtime if the SimpleUI asset exists
    directories: ['.adds/koreader/plugins/simpleui.koplugin'],
    hint: 'https://github.com/doctorhetfield-cmd/simpleui.koplugin',

    // No cleanup of its own: every file it installs sits inside KOReader's
    // directory, so KOReader's own removal takes the plugin with it. There is no
    // way to honour keeping a plugin whose parent directory is being deleted,
    // which is why it is never offered as a separate removal.

    async install(ctx) {
        const version = installableVersion('simpleui');
        if (!version) throw new Error('SimpleUI assets not available (run npm run setup:installables)');

        const label = 'Downloading SimpleUI ' + version + '...';
        ctx.progress(label);
        const zipBytes = await fetchWithProgress(
            installableAssetUrl('simpleui', 'simpleui.koplugin.zip'),
            downloadProgress(ctx.progress, label, await installableSize('simpleui')),
            'Failed to download SimpleUI',
        );
        const zip = await JSZip.loadAsync(zipBytes);

        ctx.progress('Extracting SimpleUI...');
        const files = [];
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            // The release archive is rooted at simpleui.koplugin/; a flat archive
            // is placed under that folder instead, since KOReader identifies the
            // plugin by its directory name.
            const devicePath = relativePath.startsWith('simpleui.koplugin/')
                ? '.adds/koreader/plugins/' + relativePath
                : '.adds/koreader/plugins/simpleui.koplugin/' + relativePath;
            files.push({
                path: devicePath,
                data: new Uint8Array(await entry.async('arraybuffer')),
            });
        }

        return files;
    },
};
