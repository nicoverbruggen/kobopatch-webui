import JSZip from 'jszip';

import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableVersion, installableAssetUrl } from '../../installables.js';

// A prefilled settings.ini shipped on a fresh install (written `ifAbsent`, so an
// existing user-edited file is never overwritten). NickelClock otherwise creates
// this on first boot with Margin=Auto, which hugs the screen edge tightly; 40px
// is roomier. The [Clock] (on) and [Battery] (off) sections mirror NickelClock's
// own defaults so its menu toggle works on the first reboot and the battery
// indicator stays hidden; NickelClock's syncSettings() preserves these on boot.
const DEFAULT_SETTINGS_INI = [
    '[General]',
    'Margin=40',
    '',
    '[Clock]',
    'Enabled=true',
    'Placement=Header',
    'Position=Right',
    '',
    '[Battery]',
    'BatteryType=Level',
    'Enabled=false',
    'Placement=Header',
    'Position=Right',
    'LevelTemplate=%1%',
    '',
].join('\n');

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
    description: 'Display the clock on the right in the header while you\'re reading. Adds a "NickelClock" item to the Toggle menu that turns this clock on or off.',
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
                    'Applied on the reboot after install. The clock will be visible immediately. You can toggle it from the menu, or further customize the configuration file to change how NickelClock is configured.',
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

    // Ship the on-device toggle script under .adds/nm/scripts (so NickelMenu
    // removal's recursive delete cleans it up) plus a prefilled settings.ini. The
    // script flips [Clock] Enabled in settings.ini and reboots; the matching
    // Toggle item is below. settings.ini is written `ifAbsent` so a user-edited
    // config is preserved across reinstalls.
    async install(ctx) {
        return [
            {
                path: '.adds/nm/scripts/toggle_nickelclock.sh',
                data: await ctx.asset('scripts/toggle_nickelclock.sh'),
            },
            {
                path: '.adds/nickelclock/settings.ini',
                data: new TextEncoder().encode(DEFAULT_SETTINGS_INI),
                ifAbsent: true,
            },
        ];
    },

    // Contribute the "NickelClock" Toggle-menu item that turns the reading-screen
    // clock on or off. Its position is set by 'nickelclock' in ../menu-order.js.
    menuItems() {
        return [{
            id: 'nickelclock',
            lines: ['menu_item :main :NickelClock :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_nickelclock.sh'],
        }];
    },

    /**
     * Contribute NickelClock's KoboRoot.tgz payload (its plugin + marker file) as
     * tar entries the installer merges into the combined KoboRoot.tgz. The asset
     * is a release zip wrapping a KoboRoot.tgz, mirroring NickelMenu's own asset.
     */
    async koboRootEntries(ctx) {
        const version = installableVersion('nickelclock');
        if (!version) throw new Error('NickelClock assets not available (run npm run setup:installables)');

        const label = 'Downloading NickelClock ' + version + '...';
        ctx.progress(label);
        const zipBytes = await fetchWithProgress(
            installableAssetUrl('nickelclock', 'NickelClock.zip'),
            downloadProgress(ctx.progress, label),
            'Failed to download NickelClock',
        );
        const zip = await JSZip.loadAsync(zipBytes);

        const tgzFile = zip.file('KoboRoot.tgz');
        if (!tgzFile) throw new Error('KoboRoot.tgz not found in NickelClock.zip');

        ctx.progress('Merging NickelClock into KoboRoot.tgz...');
        return parseTarGz(new Uint8Array(await tgzFile.async('arraybuffer')));
    },
};
