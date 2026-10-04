/**
 * Known Kobo hardware UUIDs mapped to the device metadata needed by the app.
 * UUIDs are authoritative for connected devices. Serial prefixes provide a
 * secondary consistency check. The first prefix is the canonical display hint.
 * Firmware downloads are keyed by the channel stored on each hardware entry.
 */
const koboHardwareIds = {
    '00000000-0000-0000-0000-000000000310': { serialPrefixes: ['N905', 'KG31'], channel: 'kobo3', model: 'Kobo Touch A/B' },
    '00000000-0000-0000-0000-000000000320': { serialPrefixes: ['N905'], channel: 'kobo4', model: 'Kobo Touch C' },
    '00000000-0000-0000-0000-000000000330': { serialPrefixes: ['N613', '613'], channel: 'kobo4', model: 'Kobo Glo' },
    '00000000-0000-0000-0000-000000000340': { serialPrefixes: ['N705'], channel: 'kobo4', model: 'Kobo Mini' },
    '00000000-0000-0000-0000-000000000350': { serialPrefixes: ['N204'], channel: 'kobo4', model: 'Kobo Aura HD' },
    '00000000-0000-0000-0000-000000000360': { serialPrefixes: ['N514', '514'], channel: 'kobo5', model: 'Kobo Aura' },
    '00000000-0000-0000-0000-000000000370': { serialPrefixes: ['N250'], channel: 'kobo5', model: 'Kobo Aura H2O' },
    '00000000-0000-0000-0000-000000000371': { serialPrefixes: ['N437'], channel: 'kobo6', model: 'Kobo Glo HD' },
    '00000000-0000-0000-0000-000000000372': { serialPrefixes: ['N587'], channel: 'kobo6', model: 'Kobo Touch 2.0' },
    '00000000-0000-0000-0000-000000000373': { serialPrefixes: ['N709'], channel: 'kobo6', model: 'Kobo Aura ONE' },
    '00000000-0000-0000-0000-000000000374': { serialPrefixes: ['N867'], channel: 'kobo6', model: 'Kobo Aura H2O Edition 2 v1' },
    '00000000-0000-0000-0000-000000000375': { serialPrefixes: ['N236'], channel: 'kobo6', model: 'Kobo Aura Edition 2 v1' },
    '00000000-0000-0000-0000-000000000376': { serialPrefixes: ['N249'], channel: 'kobo7', model: 'Kobo Clara HD' },
    '00000000-0000-0000-0000-000000000377': { serialPrefixes: ['N782'], channel: 'kobo7', model: 'Kobo Forma' },
    '00000000-0000-0000-0000-000000000378': { serialPrefixes: ['N867'], channel: 'kobo7', model: 'Kobo Aura H2O Edition 2 v2' },
    '00000000-0000-0000-0000-000000000379': { serialPrefixes: ['N236'], channel: 'kobo7', model: 'Kobo Aura Edition 2 v2' },
    '00000000-0000-0000-0000-000000000380': { serialPrefixes: ['N782'], channel: 'kobo7', model: 'Kobo Forma' },
    '00000000-0000-0000-0000-000000000381': { serialPrefixes: ['N709'], channel: 'kobo6', model: 'Kobo Aura ONE Limited Edition' },
    '00000000-0000-0000-0000-000000000382': { serialPrefixes: ['N306'], channel: 'kobo7', model: 'Kobo Nia' },
    '00000000-0000-0000-0000-000000000383': { serialPrefixes: ['N778'], channel: 'kobo8', model: 'Kobo Sage' },
    '00000000-0000-0000-0000-000000000384': { serialPrefixes: ['N873'], channel: 'kobo7', model: 'Kobo Libra H2O' },
    '00000000-0000-0000-0000-000000000386': { serialPrefixes: ['N506'], channel: 'kobo10', model: 'Kobo Clara 2E' },
    '00000000-0000-0000-0000-000000000387': { serialPrefixes: ['N604'], channel: 'kobo8', model: 'Kobo Elipsa' },
    '00000000-0000-0000-0000-000000000388': { serialPrefixes: ['N418'], channel: 'kobo9', model: 'Kobo Libra 2' },
    '00000000-0000-0000-0000-000000000389': { serialPrefixes: ['N605'], channel: 'kobo11', model: 'Kobo Elipsa 2E' },
    '00000000-0000-0000-0000-000000000390': { serialPrefixes: ['N428'], channel: 'kobo13', model: 'Kobo Libra Colour' },
    '00000000-0000-0000-0000-000000000391': { serialPrefixes: ['N365'], channel: 'kobo12', model: 'Kobo Clara BW' },
    '00000000-0000-0000-0000-000000000393': { serialPrefixes: ['N367'], channel: 'kobo12', model: 'Kobo Clara Colour' },
    '00000000-0000-0000-0000-000000000395': { serialPrefixes: ['P365'], channel: 'kobo14', model: 'Kobo Clara BW' },
};

const minimumSupportedFirmware = '4.23';

function serialPrefixMatch(expectedPrefixes, rawPrefix) {
    const actual = String(rawPrefix || '').substring(0, 4);
    if (!actual) return { matches: false, refurbished: false };

    if (expectedPrefixes.some((prefix) => prefix && actual.startsWith(prefix))) {
        return { matches: true, refurbished: false };
    }
    const canonicalPrefix = expectedPrefixes[0];
    if (actual.startsWith('R') && canonicalPrefix?.length === 4 && actual.substring(1) === canonicalPrefix.substring(1)) {
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

    const match = serialPrefixMatch(hardwareInfo.serialPrefixes, rawSerialPrefix);
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
    const serialPrefix = hardwareInfo?.serialPrefixes[0] || rawSerialPrefix;
    const model = hardwareInfo?.model || 'Unknown Kobo (' + rawSerialPrefix + ')';
    const channel = hardwareInfo?.channel || null;
    const identifiedBy = hardwareInfo ? 'uuid' : null;
    const fwParts = firmware.split('.');
    const fwMajor = parseInt(fwParts[0], 10) || 0;
    const isIncompatible = fwMajor !== 4 || compareFirmware(firmware, minimumSupportedFirmware) < 0;
    // Why the version is rejected, so the connect flow can explain it. A major
    // version above 4 is too new; anything else that lands here is too old
    // (a pre-4.23 build, or a major that could not be parsed).
    const incompatibleReason = !isIncompatible ? null : fwMajor > 4 ? 'too-new' : 'too-old';

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
        incompatibleReason,
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

export { koboHardwareIds, minimumSupportedFirmware, serialPrefixMatch, parseKoboVersion, compareFirmware, meetsMinimumVersion };
