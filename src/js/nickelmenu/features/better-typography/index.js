import { loadBundledAsset } from '../assets.js';
import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableVersion, installableAssetUrl, installableSize } from '../../installables.js';
import { meetsMinimumVersion } from '../../../kobo/version.js';

export const TOGGLE_TYPOGRAPHY_SCRIPT_URL = new URL('./scripts/toggle_typography.sh', import.meta.url).href;

// NickelTypeFix (https://github.com/nicoverbruggen/NickelTypeFix) needs Kobo
// software 4.21 or newer. The app's connect flow already rejects non-4.x
// firmware outright, so this floor is the only gate needed here.
export const nickelTypeFixMinimumFirmware = '4.21';

/**
 * Whether this install will fold in the NickelTypeFix mod: its asset must be
 * shipped by this deployment (the feature itself stays available without it —
 * the conf settings and toggle work on their own) and the device firmware must
 * meet the mod's floor. An unknown firmware (manual mode) is treated as meeting
 * it — safe to be optimistic, since the mod verifies its patch sites and sits
 * out (with a boot failsafe) on firmware it doesn't support.
 */
export function includesNickelTypeFix(deviceInfo = null) {
    if (!installableVersion('nickeltypefix')) return false;
    return meetsMinimumVersion(deviceInfo?.firmware, nickelTypeFixMinimumFirmware);
}

// Reading-experience tweaks applied to Kobo eReader.conf. These mirror what the
// "Typography Toggle" menu script does, but are set up front:
//   - webkitTextRendering=optimizeLegibility enables ligatures/GPOS kerning in
//     kepub books (the WebKit font feature the toggle script flips).
//   - readingAlignment=Left avoids the justified-text wrapping issues that the
//     optimized renderer can introduce.
//   - readingFontFamily=KF Libron is only applied when the additional fonts
//     are part of the install, so we don't point at a font that isn't there.
//
// On top of those one-time settings, this feature also folds in the on-device
// "Typography Toggle" Toggle-menu item (it ships the toggle script and inserts
// the menu entry), so the WebKit rendering mode can be flipped later without a
// reconnect. Modelled on the screensaver feature, which likewise owns both an
// asset and its menu item.
//
// Finally, on firmware that supports it, the feature installs NickelTypeFix —
// a NickelHook mod that fixes the text-rendering defects optimizeLegibility
// otherwise exposes (justification gaps, vertical CJK text) plus glyph
// "wobble" on unhinted fonts. Like NickelClock it ships inside its own
// KoboRoot.tgz, so it is merged into the single archive the installer writes
// via the generic `koboRootEntries` hook. It is also removed the same way:
// NickelHook's `uninstall_xflag` means the mod self-uninstalls on the boot
// after its .adds/nickel-type-fix/uninstall marker disappears, so cleanup just
// deletes the whole directory.
export default {
    id: 'better-typography',
    section: 'Text and typography',
    title: 'Enable better typography',
    description:
        "Turns on Kobo's optimized WebKit text rendering for proper ligatures and kerning, and switches reading to left-aligned text to avoid justification wrapping issues. Also adds an item to the Toggle menu so you can switch this rendering on or off later, and installs the NickelTypeFix mod to repair the text-rendering quirks the optimized renderer has (the mod requires Kobo software 4.21 or newer).",
    default: true,
    hint: 'https://github.com/nicoverbruggen/NickelTypeFix',

    // Detection is the revertable webkitTextRendering setting, or an on-device
    // NickelTypeFix install. The toggle script is also cleaned up explicitly
    // via cleanup.paths so it's removed regardless of how removal reaches it —
    // the NickelMenu recursive .adds/nm deletion covers it, but having the
    // explicit path makes the removal self-documenting and robust against
    // ordering changes.
    cleanup: {
        mode: 'optional',
        title: 'Better typography',
        removeLabel: 'Turn off better typography',
        description:
            'Removes the setting that enables correct kerning and ligatures in certain books, the Typography menu script, and the NickelTypeFix rendering fixes (the mod finishes removing itself on the next reboot). Your default font and reading settings are not changed.',
        detect: [['.adds', 'nickel-type-fix']],
        paths: [{ path: ['.adds', 'nm', 'scripts', 'toggle_typography.sh'] }, { path: ['.adds', 'nickel-type-fix'], recursive: true }],
    },

    reviewNotices(ctx = {}) {
        if (!includesNickelTypeFix(ctx.deviceInfo)) return [];
        return [
            {
                type: 'info',
                title: 'NickelTypeFix',
                paragraphs: [
                    'Better typography includes NickelTypeFix, a mod that fixes the rendering quirks of the optimized text renderer: uneven justification, vertical CJK text, and glyph "wobble" on unhinted fonts. It is applied on the reboot after install; every fix is fail-safe and can be configured in the .adds/nickel-type-fix folder.',
                ],
                link: {
                    label: 'NickelTypeFix on GitHub',
                    href: 'https://github.com/nicoverbruggen/NickelTypeFix',
                },
            },
        ];
    },

    // Ship the on-device toggle script. install() runs only for selected
    // features, so the script lands exactly when the feature is installed.
    async install(ctx = {}) {
        const data = ctx.bundledAsset ? await ctx.bundledAsset(TOGGLE_TYPOGRAPHY_SCRIPT_URL) : await loadBundledAsset(TOGGLE_TYPOGRAPHY_SCRIPT_URL);
        return [{ path: '.adds/nm/scripts/toggle_typography.sh', data }];
    },

    /**
     * Contribute NickelTypeFix's KoboRoot.tgz payload (its plugin + marker file)
     * as tar entries the installer merges into the combined KoboRoot.tgz. The
     * asset is the mod's release KoboRoot.tgz verbatim. Contributes nothing when
     * the deployment doesn't ship the asset or the firmware is below the mod's
     * floor — the feature's conf settings and toggle still apply on their own.
     */
    async koboRootEntries(ctx) {
        if (!includesNickelTypeFix(ctx.deviceInfo)) return [];

        const version = installableVersion('nickeltypefix');
        const label = 'Downloading NickelTypeFix ' + version + '...';
        ctx.progress(label);
        const tgz = await fetchWithProgress(
            installableAssetUrl('nickeltypefix', 'NickelTypeFix.tgz'),
            downloadProgress(ctx.progress, label, await installableSize('nickeltypefix')),
            'Failed to download NickelTypeFix',
        );

        ctx.progress('Merging NickelTypeFix into KoboRoot.tgz...');
        return parseTarGz(tgz);
    },

    // Contribute the Toggle-menu toggle that flips optimized WebKit rendering
    // on/off. cmd_output keeps the alert (which states the mode that will be
    // active) on screen for the 7s the script waits before rebooting. menuItems
    // only runs when this feature is selected, so the entry is added exactly when
    // the toggle script is shipped. Its position is set by 'typography' in
    // ../menu-order.js.
    menuItems() {
        return [
            {
                id: 'typography',
                lines: ['menu_item :main :Typography :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_typography.sh'],
            },
        ];
    },

    // Declarative Kobo eReader.conf changes, applied by the installer when a
    // device is connected. Receives the selected features so the default font is
    // only set when the additional fonts are actually being installed.
    //
    // `revertable` marks webkitTextRendering as a setting the feature owns for
    // removal: the flow/uninstaller derive detection and revert from it
    // (revertTo: null removes the line). The alignment/font settings carry no
    // such marker — they are general preferences we apply once but never claw back.
    confSettings(ctx = {}) {
        const settings = [
            {
                section: 'Reading',
                key: 'webkitTextRendering',
                value: 'optimizeLegibility',
                revertable: true,
                revertTo: null,
            },
            { section: 'Reading', key: 'readingAlignment', value: 'Left' },
        ];

        const additionalFontsInstalled = (ctx.features || []).some((f) => f.id === 'additional-fonts');
        if (additionalFontsInstalled) {
            settings.push({ section: 'Reading', key: 'readingFontFamily', value: 'KF Libron' });
        }

        return settings;
    },
};
