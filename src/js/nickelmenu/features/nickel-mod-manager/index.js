import { compareFirmware } from '../../../kobo/version.js';
import { downloadProgress } from '../../../shell/dom.js';
import { parseTarGz } from '../../archive.js';
import { installableAvailable, installableVersion, installableSize, fetchInstallableAsset } from '../../installables.js';

export default {
    id: 'nickelmodmanager',
    section: 'Interface Tweaks',
    analyticsEvent: 'add-nickelmodmanager',
    title: 'Install NickelModManager',
    description: 'Adds Manage Mods to the More tab. Turn installed mods off and on, then restart your Kobo to apply the changes.',
    default: false,
    available: false,
    minimumVersion: '4.23.15548',
    hint: 'https://github.com/nicoverbruggen/NickelModManager',

    // This deployment bundles the Qt5 package. Qt6 uses a different archive
    // and install location, even though the mod itself supports both.
    unsupportedDeviceReason(deviceInfo) {
        return deviceInfo?.firmware && compareFirmware(deviceInfo.firmware, '5.0') >= 0 ? 'This installer requires Kobo software 4.x.' : null;
    },

    reviewNotices() {
        return [
            {
                type: 'info',
                mod: {
                    name: 'NickelModManager',
                    href: 'https://github.com/nicoverbruggen/NickelModManager',
                    summary: 'lets you turn installed mods off and on from More > Manage Mods.',
                    detail: 'Changes apply after a restart. Turn on any mods you want to keep using before removing the manager.',
                },
            },
        ];
    },

    // The manager creates this marker on first startup. Deleting only the
    // marker requests removal while retaining settings and saved mod copies.
    // A leftover settings folder is not evidence that the manager is installed.
    cleanup: {
        mode: 'optional',
        title: 'NickelModManager',
        removeLabel: 'Remove NickelModManager',
        description: 'Removes the manager after a restart and keeps saved mod copies and settings. Turn on any mods you want to keep using first.',
        detect: [['.adds', 'nickel-mod-manager', 'uninstall']],
        paths: [{ path: ['.adds', 'nickel-mod-manager', 'uninstall'] }],
    },

    async koboRootEntries(ctx) {
        if (!installableAvailable('nickelmodmanager')) throw new Error('NickelModManager assets not available (run npm run setup:installables)');
        const label = 'Downloading NickelModManager ' + installableVersion('nickelmodmanager') + '...';
        ctx.progress(label);
        const tgz = await fetchInstallableAsset('nickelmodmanager', 'NickelModManager.tgz', {
            onProgress: downloadProgress(ctx.progress, label, await installableSize('nickelmodmanager')),
            errorPrefix: 'Failed to download NickelModManager',
        });
        ctx.progress('Merging NickelModManager into KoboRoot.tgz...');
        return parseTarGz(tgz);
    },
};
