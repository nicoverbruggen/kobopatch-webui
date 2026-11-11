import { firmwareMajor } from '../../../kobo/version.js';
import { downloadProgress } from '../../../shell/dom.js';
import { parseTarGz } from '../../archive.js';
import { installableAvailable, installableVersion, installableSize, fetchInstallableAsset } from '../../installables.js';

function managerPackage(deviceInfo) {
    return firmwareMajor(deviceInfo?.firmware) === 6
        ? { id: 'nickelmodmanager-qt6', asset: 'NickelModManager-Qt6.tgz', filename: 'Kobo.tgz' }
        : { id: 'nickelmodmanager', asset: 'NickelModManager.tgz', filename: 'KoboRoot.tgz' };
}

export default {
    supportedFirmwareMajors: [4, 6],
    id: 'nickelmodmanager',
    section: 'Interface Tweaks',
    analyticsEvent: 'add-nickelmodmanager',
    title: 'Install NickelModManager',
    description: (deviceInfo) =>
        firmwareMajor(deviceInfo?.firmware) === 6
            ? 'Adds Manage Mods to the More tab and restores enabled mods after supported Kobo OS updates, so you do not have to reinstall them manually.'
            : 'Adds Manage Mods to the More tab. Turn installed mods off and on, then restart your Kobo to apply the changes.',
    default: (deviceInfo) => firmwareMajor(deviceInfo?.firmware) === 6,
    available: (deviceInfo) => installableAvailable(managerPackage(deviceInfo).id),
    version: (deviceInfo) => installableVersion(managerPackage(deviceInfo).id),
    minimumVersion: '4.23.15548',
    hint: 'https://github.com/nicoverbruggen/NickelModManager',

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

    // The manager also creates this marker on first startup. Deleting only the
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

    install() {
        // An explicit reinstall must cancel a removal requested before reboot.
        // Keep the initialization receipt, settings and saved mod copies.
        return [
            {
                path: '.adds/nickel-mod-manager/uninstall',
                data: 'Delete this file and restart to remove NickelModManager.\n',
            },
        ];
    },

    async koboRootEntries(ctx) {
        const pkg = managerPackage(ctx.deviceInfo);
        if (!installableAvailable(pkg.id)) throw new Error('NickelModManager assets not available (run npm run setup:installables)');
        const label = 'Downloading NickelModManager ' + installableVersion(pkg.id) + '...';
        ctx.progress(label);
        const tgz = await fetchInstallableAsset(pkg.id, pkg.asset, {
            onProgress: downloadProgress(ctx.progress, label, await installableSize(pkg.id)),
            errorPrefix: 'Failed to download NickelModManager',
        });
        ctx.progress(`Merging NickelModManager into ${pkg.filename}...`);
        return parseTarGz(tgz);
    },
};
