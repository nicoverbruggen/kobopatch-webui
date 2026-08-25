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

    // `modifyCleanup`, not `cleanup`: the two words mean different things here.
    //
    // Removing KOReader deletes its whole directory and takes the plugin with
    // it, so the plugin is never offered as a standalone removal — the uninstall
    // lists are built from `cleanup`, and this feature declares none.
    //
    // Modifying an existing install is the opposite case: keeping KOReader and
    // unticking the plugin is a perfectly reasonable thing to ask for, and this
    // is what makes it possible.
    modifyCleanup: {
        title: 'Simple UI',
        paths: [{ path: ['.adds', 'koreader', 'plugins', 'simpleui.koplugin'], recursive: true }],
    },

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
