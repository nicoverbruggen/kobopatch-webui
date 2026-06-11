/**
 * Known Kobo device serial prefixes mapped to model names.
 * Source: https://help.kobo.com/hc/en-us/articles/360019676973
 * The serial number prefix (first 4 characters) identifies the model.
 */
const koboModels = {
    // Current eReaders
    'N428': 'Kobo Libra Colour',
    'N367': 'Kobo Clara Colour',
    'N365': 'Kobo Clara BW',
    'P365': 'Kobo Clara BW',
    'N605': 'Kobo Elipsa 2E',
    'N506': 'Kobo Clara 2E',
    'N778': 'Kobo Sage',
    'N418': 'Kobo Libra 2',
    'N604': 'Kobo Elipsa',
    'N306': 'Kobo Nia',
    'N873': 'Kobo Libra H2O',
    'N782': 'Kobo Forma',
    'N249': 'Kobo Clara HD',
    'N867': 'Kobo Aura H2O Edition 2',
    'N709': 'Kobo Aura ONE',
    'N236': 'Kobo Aura Edition 2',
    'N587': 'Kobo Touch 2.0',
    'N437': 'Kobo Glo HD',
    'N250': 'Kobo Aura H2O',
    'N514': 'Kobo Aura',
    'N613': 'Kobo Glo',
    'N705': 'Kobo Mini',
    'N416': 'Kobo Original',
    // Older models with multiple revisions
    'N905': 'Kobo Touch',
    'N647': 'Kobo Wireless',
    'N47B': 'Kobo Wireless',
    // Aura HD uses 5-char prefix
    'N204': 'Kobo Aura HD',
};

/**
 * Parse the .kobo/version file content.
 *
 * Format: serial,version1,firmware,version3,version4,hardware_uuid
 * Example: N4284B5215352,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390
 */
function parseKoboVersion(content) {
    const parts = content.split(',');
    if (parts.length < 6) {
        throw new Error(
            'Unexpected version file format. Expected 6 comma-separated fields, got ' + parts.length
        );
    }

    const serial = parts[0];
    const firmware = parts[2];
    const hardwareId = parts[5];

    const serialPrefix = serial.substring(0, 4);
    const model = koboModels[serialPrefix] || 'Unknown Kobo (' + serialPrefix + ')';
    const fwParts = firmware.split('.');
    const fwMajor = parseInt(fwParts[0], 10) || 0;
    const fwMinor = parseInt(fwParts[1], 10) || 0;
    const isIncompatible = !(fwMajor === 4 && fwMinor >= 6);

    return {
        serial,
        serialPrefix,
        firmware,
        hardwareId,
        model,
        isIncompatible,
    };
}

/**
 * Compare two Kobo firmware version strings (e.g. "4.45.23646" vs "4.31").
 * Compares segment-by-segment numerically; missing trailing segments count as
 * 0, so "4.31" and "4.31.0" are equal. Returns -1, 0, or 1.
 */
function compareFirmware(a, b) {
    const partsA = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const partsB = String(b).split('.').map(n => parseInt(n, 10) || 0);
    const length = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < length; i++) {
        const segmentA = partsA[i] || 0;
        const segmentB = partsB[i] || 0;
        if (segmentA !== segmentB) return segmentA < segmentB ? -1 : 1;
    }

    return 0;
}

/**
 * Whether `firmware` is at least `minimum`. A missing `minimum` means the
 * feature has no floor; a missing `firmware` (e.g. manual mode, where the OS
 * version is unknown) is treated as meeting it so we don't gate blindly.
 */
function meetsMinimumVersion(firmware, minimum) {
    if (!minimum) return true;
    if (!firmware) return true;
    return compareFirmware(firmware, minimum) >= 0;
}

export { koboModels, parseKoboVersion, compareFirmware, meetsMinimumVersion };
