import { getConfSetting, removeConfSetting, setConfSetting } from '../kobo/configuration.js';

const eReaderConfPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
const nickelMenuTgzPath = ['.kobo', 'KoboRoot.tgz'];
const nickelMenuRecursiveAssetPaths = [
    ['.adds', 'nm'],
];
const nickelMenuUninstallMarkerPath = ['.adds', 'nm', 'uninstall'];
const syncExclusionIgnoredAddsDirectories = new Set(['nm']);

function hasAddsDirectoriesRequiringSyncExclusions(entries = []) {
    return entries.some(entry =>
        entry.kind === 'directory' && !syncExclusionIgnoredAddsDirectories.has(entry.name)
    );
}

async function removeOptionalEntry(device, path, options, logger) {
    try {
        await device.removeEntry(path, options);
    } catch (err) {
        logger.warn(`Could not remove ${path.join('/')}:`, err);
    }
}

async function removeCleanupParentDirsIfEmpty(device, cleanup, logger) {
    for (const path of cleanup.removeParentDirsIfEmpty || []) {
        if (!await device.pathExists(path)) continue;

        const remainingEntries = await device.listDirectory(path);
        if (remainingEntries.length === 0) {
            await removeOptionalEntry(device, path, {}, logger);
        }
    }
}

/**
 * Undo a feature's Kobo eReader.conf changes. Each entry only reverts when the
 * current value still matches what the feature set, so user customisations made
 * afterwards are never clobbered. `revertTo: null` removes the line entirely;
 * any string (including '') sets the key to that value.
 */
async function applyConfReverts(device, cleanup) {
    if (!cleanup.revertConf?.length) return;

    let content = await device.readFile(eReaderConfPath);
    if (!content) return;

    let changed = false;
    for (const { section, key, value, revertTo } of cleanup.revertConf) {
        if (getConfSetting(content, section, key) !== value) continue;
        content = (revertTo === null || revertTo === undefined)
            ? removeConfSetting(content, section, key)
            : setConfSetting(content, section, key, revertTo);
        changed = true;
    }

    if (changed) {
        await device.writeFile(eReaderConfPath, new TextEncoder().encode(content));
    }
}

async function executeFeatureCleanup(device, feature, logger) {
    const cleanup = feature.cleanup;
    if (!cleanup) return;

    for (const entry of cleanup.paths || []) {
        const path = typeof entry === 'string' ? entry.split('/') : entry.path;
        const options = typeof entry === 'string' ? {} : { recursive: !!entry.recursive };
        await removeOptionalEntry(device, path, options, logger);
    }

    await removeCleanupParentDirsIfEmpty(device, cleanup, logger);
    await applyConfReverts(device, cleanup);
}

async function executeNickelMenuRemoval({
    device,
    installer,
    cleanupFeatures = [],
    shouldRemoveSyncExclusions,
    onProgress = () => {},
    logger = console,
}) {
    await installer.loadNickelMenu(onProgress);

    onProgress('Writing KoboRoot.tgz...');
    const tgz = await installer.getKoboRootTgz();
    await device.writeFile(nickelMenuTgzPath, tgz);

    onProgress('Removing NickelMenu assets...');
    for (const path of nickelMenuRecursiveAssetPaths) {
        await removeOptionalEntry(device, path, { recursive: true }, logger);
    }

    const alwaysCleanupFeatures = cleanupFeatures.filter(feature => feature.cleanup?.mode === 'always');
    for (const feature of alwaysCleanupFeatures) {
        await executeFeatureCleanup(device, feature, logger);
    }

    onProgress('Creating uninstall marker...');
    await device.writeFile(nickelMenuUninstallMarkerPath, new Uint8Array(0));

    const optionalCleanupFeatures = cleanupFeatures.filter(feature => feature.cleanup && feature.cleanup.mode !== 'always');
    for (const feature of optionalCleanupFeatures) {
        onProgress('Removing ' + feature.cleanup.title + '...');
        await executeFeatureCleanup(device, feature, logger);
    }

    if (await shouldRemoveSyncExclusions()) {
        onProgress('Removing Kobo eReader.conf sync exclusions...');
        await installer.removeExcludeSyncFolders(device);
    } else {
        await installer.repairLegacyExcludeSyncFolders(device);
    }
}

export {
    executeNickelMenuRemoval,
    hasAddsDirectoriesRequiringSyncExclusions,
    nickelMenuRecursiveAssetPaths,
    nickelMenuTgzPath,
    nickelMenuUninstallMarkerPath,
};
