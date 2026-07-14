import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableAvailable, installableVersion, installableAssetUrl, installableSize } from '../../installables.js';

// Installs NickelCoverFix (https://github.com/nicoverbruggen/NickelCoverFix),
// which keeps book covers from blanking to the title/author placeholder when
// Kobo cannot fetch them, and lets you set up custom covers for select books.
// Like NickelTypeFix it ships as a bare KoboRoot.tgz (a NickelHook plugin), so
// its payload is merged into the single KoboRoot.tgz the installer writes via
// the generic `koboRootEntries` hook.
//
// Removal follows the shared convention for these mods (an uninstall_xflag):
// the mod is installed exactly when its .adds/nickel-cover-fix/uninstall marker
// exists, and it self-uninstalls on the boot after that marker disappears. So
// cleanup just deletes the whole .adds/nickel-cover-fix directory — that removes
// the marker (triggering the self-uninstall of the root-filesystem plugin) and
// clears the onboard footprint (mirrored covers, config, logs) in one step.
export default {
    id: 'nickelcoverfix',
    section: 'Advanced',
    title: 'Alternative cover handling',
    description:
        'Keeps book covers from turning into the plain title/author placeholder when Kobo cannot fetch them (e.g. offline or after a sync). Also lets you set up custom covers for select books, including books purchased from the Kobo Store.',
    default: false,
    experimental: true,
    hidden: true,
    available: false, // set to true at runtime if NickelCoverFix assets exist
    directories: ['.adds/nickel-cover-fix'],
    hint: 'https://github.com/nicoverbruggen/NickelCoverFix',

    reviewNotices() {
        return [
            {
                type: 'warning',
                title: 'NickelCoverFix',
                paragraphs: [
                    'Applied on the reboot after install. Covers are mirrored automatically as books are shown; with a large library, open "More > Repair Book Covers" on the device once to prepare all covers in one pass. Learn more on GitHub.',
                ],
                link: {
                    label: 'NickelCoverFix on GitHub',
                    href: 'https://github.com/nicoverbruggen/NickelCoverFix',
                },
            },
        ];
    },

    cleanup: {
        mode: 'optional',
        title: 'NickelCoverFix',
        removeLabel: 'Remove NickelCoverFix (.adds/nickel-cover-fix)',
        description:
            'Removes NickelCoverFix and its mirrored covers. Deleting its folder triggers the mod to finish removing its own plugin on the next reboot.',
        detect: [['.adds', 'nickel-cover-fix', 'uninstall']],
        paths: [{ path: ['.adds', 'nickel-cover-fix'], recursive: true }],
    },

    /**
     * Contribute NickelCoverFix's KoboRoot.tgz payload (its plugin + marker file)
     * as tar entries the installer merges into the combined KoboRoot.tgz. The
     * asset is the mod's release KoboRoot.tgz verbatim.
     */
    async koboRootEntries(ctx) {
        if (!installableAvailable('nickelcoverfix')) throw new Error('NickelCoverFix assets not available (run npm run setup:installables)');
        const version = installableVersion('nickelcoverfix');

        const label = 'Downloading NickelCoverFix ' + version + '...';
        ctx.progress(label);
        const tgz = await fetchWithProgress(
            installableAssetUrl('nickelcoverfix', 'NickelCoverFix.tgz'),
            downloadProgress(ctx.progress, label, await installableSize('nickelcoverfix')),
            'Failed to download NickelCoverFix',
        );

        ctx.progress('Merging NickelCoverFix into KoboRoot.tgz...');
        return parseTarGz(tgz);
    },
};
