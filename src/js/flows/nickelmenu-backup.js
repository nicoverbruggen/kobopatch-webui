export const NM_REVIEW_BACKUP_PATHS = [
    ['.kobo', 'Kobo'],
    ['.kobo', 'markups'],
    ['.kobo', 'BookReader.sqlite'],
    ['.kobo', 'device.salt.conf'],
    ['.kobo', 'fonts.sqlite'],
    ['.kobo', 'KoboReader.sqlite'],
    ['.kobo', 'version'],
];

export function shouldOfferNmBackup(state) {
    return !state.manualMode && !!state.device.directoryHandle;
}

export function buildBackupFilename(deviceInfo) {
    const serial = deviceInfo?.serial || 'UNKNOWN SERIAL';
    const now = new Date();
    const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-') + ' ' + [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('-');
    return `KoboPatch Backup (${serial}) - ${timestamp}.zip`;
}

export async function prepareNmBackup(state) {
    const backupPaths = [...NM_REVIEW_BACKUP_PATHS];
    if (await state.device.pathExists(['.adds', 'nm'])) {
        backupPaths.push(['.adds', 'nm']);
    }

    const entries = await state.device.collectExistingEntries(backupPaths);

    if (entries.length === 0) {
        throw new Error('No backup files were found on the connected Kobo.');
    }

    return { entries, filename: buildBackupFilename(state.device.deviceInfo) };
}
