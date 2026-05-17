const nickelMenuTgzPath = ['.kobo', 'KoboRoot.tgz'];
const nickelMenuAssetPaths = [
    ['.adds', 'nm'],
    ['.adds', 'scripts'],
];
const nickelMenuUninstallMarkerPath = ['.adds', 'nm', 'uninstall'];

async function removeOptionalEntry(device, path, options, logger) {
    try {
        await device.removeEntry(path, options);
    } catch (err) {
        logger.warn(`Could not remove ${path.join('/')}:`, err);
    }
}

async function executeNickelMenuRemoval({
    device,
    installer,
    featuresToRemove = [],
    shouldRemoveSyncExclusions,
    onProgress = () => {},
    logger = console,
}) {
    await installer.loadNickelMenu(onProgress);

    onProgress('Writing KoboRoot.tgz...');
    const tgz = await installer.getKoboRootTgz();
    await device.writeFile(nickelMenuTgzPath, tgz);

    onProgress('Removing NickelMenu assets...');
    for (const path of nickelMenuAssetPaths) {
        await removeOptionalEntry(device, path, { recursive: true }, logger);
    }

    onProgress('Creating uninstall marker...');
    await device.writeFile(nickelMenuUninstallMarkerPath, new Uint8Array(0));

    for (const feature of featuresToRemove) {
        onProgress('Removing ' + feature.uninstall.title + '...');
        for (const entry of feature.uninstall.paths) {
            await removeOptionalEntry(device, entry.path, { recursive: !!entry.recursive }, logger);
        }
    }

    if (await shouldRemoveSyncExclusions()) {
        onProgress('Removing Kobo eReader.conf sync exclusions...');
        await installer.removeExcludeSyncFolders(device);
    }
}

export {
    executeNickelMenuRemoval,
    nickelMenuAssetPaths,
    nickelMenuTgzPath,
    nickelMenuUninstallMarkerPath,
};
