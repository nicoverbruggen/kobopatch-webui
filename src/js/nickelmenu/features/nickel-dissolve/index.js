import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableAvailable, installableVersion, installableAssetUrl, installableSize } from '../../installables.js';

// Installs NickelDissolve (https://github.com/nicoverbruggen/NickelDissolve),
// an experimental mod that gives page turns a Kindle-style directional wipe
// animation. Like NickelTypeFix it ships as a bare KoboRoot.tgz (a NickelHook
// plugin), so its payload is merged into the single KoboRoot.tgz the installer
// writes via the generic `koboRootEntries` hook.
//
// Removal follows the shared convention for these mods (an uninstall_xflag):
// the mod is installed exactly when its .adds/nickel-dissolve/uninstall marker
// exists, and it self-uninstalls on the boot after that marker disappears. So
// cleanup just deletes the whole .adds/nickel-dissolve directory — that removes
// the marker (triggering the self-uninstall of the root-filesystem plugin) and
// clears the onboard footprint (config, logs) in one step.

/**
 * The only devices NickelDissolve is offered on, keyed by hardware UUID (see
 * `koboHardwareIds` in kobo/version.js). A strict allowlist — other devices,
 * including unrecognised future hardware, are not supported. Clara BW appears
 * twice because it has two hardware revisions (N365 and P365).
 */
const SUPPORTED_HARDWARE_IDS = new Set([
    '00000000-0000-0000-0000-000000000390', // N428 Kobo Libra Colour
    '00000000-0000-0000-0000-000000000391', // N365 Kobo Clara BW
    '00000000-0000-0000-0000-000000000393', // N367 Kobo Clara Colour
    '00000000-0000-0000-0000-000000000395', // P365 Kobo Clara BW
]);

/**
 * Determine whether a parsed device supports NickelDissolve. Returns 'unknown'
 * when the device cannot be identified (manual mode / download flow) — the
 * feature is still offered then, and the mod itself stays inert on unsupported
 * hardware — and 'supported'/'unsupported' from the allowlist otherwise.
 */
export function nickelDissolveSupport(deviceInfo) {
    if (!deviceInfo?.hardwareId) return 'unknown';
    return SUPPORTED_HARDWARE_IDS.has(deviceInfo.hardwareId) ? 'supported' : 'unsupported';
}

export default {
    id: 'nickeldissolve',
    section: 'Reading Experience',
    analyticsEvent: 'add-nickeldissolve',
    title: 'Page turn animations',
    description:
        'Adds a Kindle-style directional wipe animation to page turns while reading. Experimental, and only supported on the Kobo Libra Colour, Clara Colour, and Clara BW.',
    default: false,
    experimental: false,
    available: false, // set to true at runtime if NickelDissolve assets exist
    directories: ['.adds/nickel-dissolve'],
    hint: 'https://github.com/nicoverbruggen/NickelDissolve',

    // Generic device gate: the flow disables the checkbox with this reason and
    // featuresToInstall drops the feature when it returns a string. Null when
    // the device is supported or cannot be identified (manual mode).
    unsupportedDeviceReason(deviceInfo) {
        if (nickelDissolveSupport(deviceInfo) !== 'unsupported') return null;
        const suffix = deviceInfo.model ? ` (this device is a ${deviceInfo.model}).` : '.';
        return `Only supported on the Kobo Libra Colour, Clara Colour, and Clara BW${suffix}`;
    },

    reviewNotices() {
        return [
            {
                type: 'info',
                title: 'NickelDissolve',
                paragraphs: [
                    'NickelDissolve adds a Kindle-style wipe animation to page turns. Applied on the reboot after install. On an unsupported device it stays inert (no animation, no risk).',
                ],
                link: {
                    label: 'NickelDissolve on GitHub',
                    href: 'https://github.com/nicoverbruggen/NickelDissolve',
                },
            },
        ];
    },

    cleanup: {
        mode: 'optional',
        title: 'NickelDissolve',
        removeLabel: 'Remove NickelDissolve (.adds/nickel-dissolve)',
        description: 'Removes the page turn animation mod. Deleting its folder triggers the mod to finish removing its own plugin on the next reboot.',
        detect: [['.adds', 'nickel-dissolve', 'uninstall']],
        paths: [{ path: ['.adds', 'nickel-dissolve'], recursive: true }],
    },

    /**
     * Contribute NickelDissolve's KoboRoot.tgz payload (its plugin + marker file)
     * as tar entries the installer merges into the combined KoboRoot.tgz. The
     * asset is the mod's release KoboRoot.tgz verbatim.
     */
    async koboRootEntries(ctx) {
        if (!installableAvailable('nickeldissolve')) throw new Error('NickelDissolve assets not available (run npm run setup:installables)');
        const version = installableVersion('nickeldissolve');

        const label = 'Downloading NickelDissolve ' + version + '...';
        ctx.progress(label);
        const tgz = await fetchWithProgress(
            installableAssetUrl('nickeldissolve', 'NickelDissolve.tgz'),
            downloadProgress(ctx.progress, label, await installableSize('nickeldissolve')),
            'Failed to download NickelDissolve',
        );

        ctx.progress('Merging NickelDissolve into KoboRoot.tgz...');
        return parseTarGz(tgz);
    },
};
