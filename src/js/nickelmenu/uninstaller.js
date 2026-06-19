import { getConfSetting, removeConfSetting, setConfSetting } from '../kobo/configuration.js';
import { revertableConfSettings, writeAuditLog } from './installer.js';

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

function isNotFoundError(err) {
    return err?.name === 'NotFoundError';
}

async function removeOptionalEntry(device, path, options, logger, audit = null) {
    try {
        await device.removeEntry(path, options);
        audit?.record(`Removed ${path.join('/')}`);
    } catch (err) {
        if (isNotFoundError(err)) return;
        logger.warn(`Could not remove ${path.join('/')}:`, err);
        throw err;
    }
}

async function removeCleanupParentDirsIfEmpty(device, cleanup, logger, audit = null) {
    for (const path of cleanup.removeParentDirsIfEmpty || []) {
        if (!await device.pathExists(path)) continue;

        const remainingEntries = await device.listDirectory(path);
        if (remainingEntries.length === 0) {
            await removeOptionalEntry(device, path, {}, logger, audit);
        }
    }
}

/**
 * Undo a feature's Kobo eReader.conf changes — the `revertable` entries it
 * declares in `confSettings`. Each entry only reverts when the current value
 * still matches what the feature set, so user customisations made afterwards are
 * never overwritten. `revertTo: null` (or absent) removes the line entirely; any
 * string (including '') sets the key to that value.
 */
async function applyConfReverts(device, feature, audit = null) {
    const reverts = revertableConfSettings(feature, { deviceInfo: device.deviceInfo, features: [] });
    if (!reverts.length) return;

    let content = await device.readFile(eReaderConfPath);
    if (!content) return;

    let changed = false;
    for (const { section, key, value, revertTo } of reverts) {
        if (getConfSetting(content, section, key) !== value) continue;
        content = (revertTo === null || revertTo === undefined)
            ? removeConfSetting(content, section, key)
            : setConfSetting(content, section, key, revertTo);
        audit?.record(revertTo === null || revertTo === undefined
            ? `Removed Kobo eReader.conf [${section}] ${key}`
            : `Reverted Kobo eReader.conf [${section}] ${key}=${revertTo}`);
        changed = true;
    }

    if (changed) {
        await device.writeFile(eReaderConfPath, new TextEncoder().encode(content));
    }
}

async function executeFeatureCleanup(device, feature, logger, audit = null) {
    const cleanup = feature.cleanup;
    if (!cleanup) return;

    for (const entry of cleanup.paths || []) {
        const path = typeof entry === 'string' ? entry.split('/') : entry.path;
        const options = typeof entry === 'string' ? {} : { recursive: !!entry.recursive };
        await removeOptionalEntry(device, path, options, logger, audit);
    }

    await removeCleanupParentDirsIfEmpty(device, cleanup, logger, audit);
    await applyConfReverts(device, feature, audit);
}

async function executeNickelMenuRemoval({
    device,
    installer,
    cleanupFeatures = [],
    shouldRemoveSyncExclusions,
    onProgress = () => {},
    logger = console,
    audit = null,
}) {
    await installer.loadNickelMenu(onProgress);
    const tgz = await installer.getKoboRootTgz();

    onProgress('Removing NickelMenu assets...');
    for (const path of nickelMenuRecursiveAssetPaths) {
        await removeOptionalEntry(device, path, { recursive: true }, logger, audit);
    }

    const alwaysCleanupFeatures = cleanupFeatures.filter(feature => feature.cleanup?.mode === 'always');
    for (const feature of alwaysCleanupFeatures) {
        await executeFeatureCleanup(device, feature, logger, audit);
    }

    onProgress('Creating uninstall marker...');
    await device.writeFile(nickelMenuUninstallMarkerPath, new Uint8Array(0));
    audit?.record(`Wrote uninstall marker ${nickelMenuUninstallMarkerPath.join('/')}`);

    const optionalCleanupFeatures = cleanupFeatures.filter(feature => feature.cleanup && feature.cleanup.mode !== 'always');
    for (const feature of optionalCleanupFeatures) {
        onProgress('Removing ' + feature.cleanup.title + '...');
        audit?.record(`Removing ${feature.cleanup.title}`);
        await executeFeatureCleanup(device, feature, logger, audit);
    }

    if (await shouldRemoveSyncExclusions()) {
        onProgress('Removing Kobo eReader.conf sync exclusions...');
        await installer.removeExcludeSyncFolders(device);
        audit?.record('Removed Kobo eReader.conf sync exclusions');
    } else {
        await installer.repairLegacyExcludeSyncFolders(device);
    }

    onProgress('Writing KoboRoot.tgz...');
    await device.writeFile(nickelMenuTgzPath, tgz);
    audit?.record(`Removing NickelMenu: wrote ${nickelMenuTgzPath.join('/')} (${tgz.length} bytes)`);

    await writeAuditLog(audit, device);
}

export {
    executeNickelMenuRemoval,
    hasAddsDirectoriesRequiringSyncExclusions,
    nickelMenuRecursiveAssetPaths,
    nickelMenuTgzPath,
    nickelMenuUninstallMarkerPath,
};
