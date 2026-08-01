/**
 * Known Kobo hardware UUIDs mapped to the device metadata needed by the app.
 * UUIDs are authoritative for connected devices. The serial prefix is a
 * secondary consistency check and display hint; firmware downloads are keyed
 * by the channel stored on each hardware entry.
 */
const koboHardwareIds = {
    '00000000-0000-0000-0000-000000000310': { serialPrefix: 'N905', channel: 'kobo3', model: 'Kobo Touch A/B' },
    '00000000-0000-0000-0000-000000000320': { serialPrefix: 'N905', channel: 'kobo4', model: 'Kobo Touch C' },
    '00000000-0000-0000-0000-000000000330': { serialPrefix: 'N613', channel: 'kobo4', model: 'Kobo Glo' },
    '00000000-0000-0000-0000-000000000340': { serialPrefix: 'N705', channel: 'kobo4', model: 'Kobo Mini' },
    '00000000-0000-0000-0000-000000000350': { serialPrefix: 'N204', channel: 'kobo4', model: 'Kobo Aura HD' },
    '00000000-0000-0000-0000-000000000360': { serialPrefix: 'N514', channel: 'kobo5', model: 'Kobo Aura' },
    '00000000-0000-0000-0000-000000000370': { serialPrefix: 'N250', channel: 'kobo5', model: 'Kobo Aura H2O' },
    '00000000-0000-0000-0000-000000000371': { serialPrefix: 'N437', channel: 'kobo6', model: 'Kobo Glo HD' },
    '00000000-0000-0000-0000-000000000372': { serialPrefix: 'N587', channel: 'kobo6', model: 'Kobo Touch 2.0' },
    '00000000-0000-0000-0000-000000000373': { serialPrefix: 'N709', channel: 'kobo6', model: 'Kobo Aura ONE' },
    '00000000-0000-0000-0000-000000000374': { serialPrefix: 'N867', channel: 'kobo6', model: 'Kobo Aura H2O Edition 2 v1' },
    '00000000-0000-0000-0000-000000000375': { serialPrefix: 'N236', channel: 'kobo6', model: 'Kobo Aura Edition 2 v1' },
    '00000000-0000-0000-0000-000000000376': { serialPrefix: 'N249', channel: 'kobo7', model: 'Kobo Clara HD' },
    '00000000-0000-0000-0000-000000000377': { serialPrefix: 'N782', channel: 'kobo7', model: 'Kobo Forma' },
    '00000000-0000-0000-0000-000000000378': { serialPrefix: 'N867', channel: 'kobo7', model: 'Kobo Aura H2O Edition 2 v2' },
    '00000000-0000-0000-0000-000000000379': { serialPrefix: 'N236', channel: 'kobo7', model: 'Kobo Aura Edition 2 v2' },
    '00000000-0000-0000-0000-000000000380': { serialPrefix: 'N782', channel: 'kobo7', model: 'Kobo Forma' },
    '00000000-0000-0000-0000-000000000381': { serialPrefix: 'N709', channel: 'kobo6', model: 'Kobo Aura ONE Limited Edition' },
    '00000000-0000-0000-0000-000000000382': { serialPrefix: 'N306', channel: 'kobo7', model: 'Kobo Nia' },
    '00000000-0000-0000-0000-000000000383': { serialPrefix: 'N778', channel: 'kobo8', model: 'Kobo Sage' },
    '00000000-0000-0000-0000-000000000384': { serialPrefix: 'N873', channel: 'kobo7', model: 'Kobo Libra H2O' },
    '00000000-0000-0000-0000-000000000386': { serialPrefix: 'N506', channel: 'kobo10', model: 'Kobo Clara 2E' },
    '00000000-0000-0000-0000-000000000387': { serialPrefix: 'N604', channel: 'kobo8', model: 'Kobo Elipsa' },
    '00000000-0000-0000-0000-000000000388': { serialPrefix: 'N418', channel: 'kobo9', model: 'Kobo Libra 2' },
    '00000000-0000-0000-0000-000000000389': { serialPrefix: 'N605', channel: 'kobo11', model: 'Kobo Elipsa 2E' },
    '00000000-0000-0000-0000-000000000390': { serialPrefix: 'N428', channel: 'kobo13', model: 'Kobo Libra Colour' },
    '00000000-0000-0000-0000-000000000391': { serialPrefix: 'N365', channel: 'kobo12', model: 'Kobo Clara BW' },
    '00000000-0000-0000-0000-000000000393': { serialPrefix: 'N367', channel: 'kobo12', model: 'Kobo Clara Colour' },
    '00000000-0000-0000-0000-000000000395': { serialPrefix: 'P365', channel: 'kobo14', model: 'Kobo Clara BW' },
};

const minimumSupportedFirmware = '4.23';

// Kobo's 5.x line is not supported yet, which is why parseKoboVersion rejects
// every major version other than 4. Shown to the user in the manual
// instructions, where there is no device to check.
const firstUnsupportedFirmware = '5.0';

function serialPrefixMatch(expectedPrefix, rawPrefix) {
    const expected = String(expectedPrefix || '').substring(0, 4);
    const actual = String(rawPrefix || '').substring(0, 4);
    if (!expected || !actual) return { matches: false, refurbished: false };

    if (actual === expected) return { matches: true, refurbished: false };
    if (actual.startsWith('R') && actual.substring(1) === expected.substring(1)) {
        return { matches: true, refurbished: true };
    }

    return { matches: false, refurbished: false };
}

function deviceVerificationFor(hardwareInfo, rawSerialPrefix) {
    if (!hardwareInfo) {
        return {
            deviceVerification: 'unknown',
            serialPrefixStatus: 'unknown',
            serialPrefixMatches: false,
            isRefurbished: false,
        };
    }

    const match = serialPrefixMatch(hardwareInfo.serialPrefix, rawSerialPrefix);
    if (!match.matches) {
        return {
            deviceVerification: 'mismatch',
            serialPrefixStatus: 'mismatch',
            serialPrefixMatches: false,
            isRefurbished: false,
        };
    }

    return {
        deviceVerification: 'verified',
        serialPrefixStatus: match.refurbished ? 'refurbished' : 'verified',
        serialPrefixMatches: true,
        isRefurbished: match.refurbished,
    };
}

/**
 * Parse the .kobo/version file content.
 *
 * Format: serial,version1,firmware,version3,version4,hardware_uuid
 * Example: N428000000000,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390
 */
function parseKoboVersion(content) {
    const parts = content.split(',');
    if (parts.length < 6) {
        throw new Error('Unexpected version file format. Expected 6 comma-separated fields, got ' + parts.length);
    }

    const serial = parts[0];
    const firmware = parts[2];
    const hardwareId = parts[5];

    const rawSerialPrefix = serial.substring(0, 4);
    const hardwareInfo = koboHardwareIds[hardwareId] || null;
    const verification = deviceVerificationFor(hardwareInfo, rawSerialPrefix);
    const serialPrefix = hardwareInfo?.serialPrefix || rawSerialPrefix;
    const model = hardwareInfo?.model || 'Unknown Kobo (' + rawSerialPrefix + ')';
    const channel = hardwareInfo?.channel || null;
    const identifiedBy = hardwareInfo ? 'uuid' : null;
    const fwParts = firmware.split('.');
    const fwMajor = parseInt(fwParts[0], 10) || 0;
    const isIncompatible = fwMajor !== 4 || compareFirmware(firmware, minimumSupportedFirmware) < 0;

    return {
        serial,
        serialPrefix,
        rawSerialPrefix,
        firmware,
        hardwareId,
        model,
        channel,
        identifiedBy,
        ...verification,
        isIncompatible,
    };
}

/**
 * Compare two Kobo firmware version strings (e.g. "4.45.23646" vs "4.31").
 * Compares segment-by-segment numerically; missing trailing segments count as
 * 0, so "4.31" and "4.31.0" are equal. Returns -1, 0, or 1.
 */
function compareFirmware(a, b) {
    const partsA = String(a)
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const partsB = String(b)
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
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

export { koboHardwareIds, minimumSupportedFirmware, firstUnsupportedFirmware, serialPrefixMatch, parseKoboVersion, compareFirmware, meetsMinimumVersion };
