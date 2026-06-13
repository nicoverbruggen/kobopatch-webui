import JSZip from 'jszip';

import { parseTarGz } from '../../archive.js';

// Installs NickelClock (https://github.com/shermp/NickelClock), which shows a
// clock and battery indicator while reading. Like NickelMenu, it ships as a Qt
// imageformats plugin inside its own KoboRoot.tgz, so it cannot be expressed as
// ordinary onboard files: the installer merges its payload into the single
// KoboRoot.tgz it writes via the generic `koboRootEntries` hook.
//
// Removal is the INVERSE of NickelMenu's. Both are built on shermp's NickelHook
// framework, but they use opposite uninstall triggers:
//   - NickelMenu declares an `uninstall_flag`  → it uninstalls when the marker
//     file .adds/nm/uninstall *exists*, which is why our uninstaller *writes*
//     that marker.
//   - NickelClock declares an `uninstall_xflag` → it uninstalls when the marker
//     file .adds/nickelclock/uninstall is *absent* (its shipped `uninstall`
//     file even reads "Delete this file, and restart your Kobo").
// So NickelClock is removed by DELETING its marker, not writing one. On the next
// boot NickelHook sees the xflag missing and runs the mod's own uninstall, which
// removes libnickelclock.so (root filesystem) plus settings.ini and the dir.
// Deleting the whole .adds/nickelclock directory removes that marker (triggering
// the self-uninstall) and clears the onboard footprint in one step — the same
// shape as every other add-on cleanup here — so no KoboRoot.tgz is needed.
export default {
    id: 'nickelclock',
    section: 'Advanced',
    title: 'Install NickelClock',
    description: 'Installs NickelClock, which shows a clock (and optional battery indicator) in the header or footer while you read. After installing, adjust its placement and options in .adds/nickelclock/settings.ini. It is bundled into the same KoboRoot.tgz as NickelMenu and applied on the same reboot.',
    default: false,
    available: false, // set to true at runtime if NickelClock assets exist
    directories: ['.adds/nickelclock'],
    hint: 'https://github.com/shermp/NickelClock',

    reviewNotices() {
        return [
            {
                type: 'info',
                title: 'NickelClock',
                paragraphs: [
                    'NickelClock is merged into the same KoboRoot.tgz as NickelMenu and takes effect after the reboot that follows installation. Configure the clock and battery placement afterwards in .adds/nickelclock/settings.ini.',
                ],
                link: {
                    label: 'NickelClock on GitHub',
                    href: 'https://github.com/shermp/NickelClock',
                },
            },
        ];
    },

    cleanup: {
        mode: 'optional',
        title: 'NickelClock',
        removeLabel: 'Remove NickelClock (.adds/nickelclock)',
        description: 'Removes NickelClock. Deleting its folder triggers NickelClock to finish removing its own plugin on the next reboot.',
        detect: [['.adds', 'nickelclock']],
        paths: [
            { path: ['.adds', 'nickelclock'], recursive: true },
        ],
    },

    /**
     * Contribute NickelClock's KoboRoot.tgz payload (its plugin + marker file) as
     * tar entries the installer merges into the combined KoboRoot.tgz. The asset
     * is a release zip wrapping a KoboRoot.tgz, mirroring NickelMenu's own asset.
     */
    async koboRootEntries(ctx) {
        ctx.progress('Fetching NickelClock release info...');
        const metaResp = await fetch('/assets/nickelclock-release.json');
        if (!metaResp.ok) throw new Error('NickelClock assets not available (run npm run setup:installables)');
        const meta = await metaResp.json();

        ctx.progress('Downloading NickelClock ' + meta.version + '...');
        const zipResp = await fetch('/assets/NickelClock.zip');
        if (!zipResp.ok) throw new Error('Failed to download NickelClock: HTTP ' + zipResp.status);
        const zip = await JSZip.loadAsync(await zipResp.arrayBuffer());

        const tgzFile = zip.file('KoboRoot.tgz');
        if (!tgzFile) throw new Error('KoboRoot.tgz not found in NickelClock.zip');

        ctx.progress('Merging NickelClock into KoboRoot.tgz...');
        return parseTarGz(new Uint8Array(await tgzFile.async('arraybuffer')));
    },
};
