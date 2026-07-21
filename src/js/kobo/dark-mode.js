/**
 * Hardware UUIDs of older Kobo eReaders that do NOT support Dark mode.
 * Source: https://help.kobo.com/hc/en-us/articles/360062231213-About-Dark-mode
 *
 * Keyed by the hardware UUID (the authoritative device identifier from
 * .kobo/version), not the serial prefix: a prefix can be shared across model
 * revisions (e.g. the two Kobo Forma UUIDs both use N782), whereas the UUID
 * identifies the revision exactly. See `koboHardwareIds` in version.js.
 *
 * This is kept as a blacklist of older devices rather than an allowlist of
 * supported ones: Dark mode is standard on current hardware, so unrecognised and
 * future UUIDs are assumed to support it.
 *
 * Note: a few pre-Dark-mode models (Kobo Original/Touch/Wireless) have no UUID
 * mapping in version.js and are intentionally omitted — their firmware is below
 * the app's 4.23 minimum, so they never reach the NickelMenu feature selection.
 */
const darkModeUnsupportedHardwareIds = new Set([
    '00000000-0000-0000-0000-000000000310', // N905 Kobo Touch A/B
    '00000000-0000-0000-0000-000000000320', // N905 Kobo Touch C
    '00000000-0000-0000-0000-000000000330', // N613 Kobo Glo
    '00000000-0000-0000-0000-000000000340', // N705 Kobo Mini
    '00000000-0000-0000-0000-000000000350', // N204 Kobo Aura HD
    '00000000-0000-0000-0000-000000000360', // N514 Kobo Aura
    '00000000-0000-0000-0000-000000000370', // N250 Kobo Aura H2O
    '00000000-0000-0000-0000-000000000371', // N437 Kobo Glo HD
    '00000000-0000-0000-0000-000000000372', // N587 Kobo Touch 2.0
    '00000000-0000-0000-0000-000000000373', // N709 Kobo Aura ONE
    '00000000-0000-0000-0000-000000000374', // N867 Kobo Aura H2O Edition 2 v1
    '00000000-0000-0000-0000-000000000375', // N236 Kobo Aura Edition 2 v1
    '00000000-0000-0000-0000-000000000376', // N249 Kobo Clara HD
    '00000000-0000-0000-0000-000000000377', // N782 Kobo Forma
    '00000000-0000-0000-0000-000000000378', // N867 Kobo Aura H2O Edition 2 v2
    '00000000-0000-0000-0000-000000000379', // N236 Kobo Aura Edition 2 v2
    '00000000-0000-0000-0000-000000000380', // N782 Kobo Forma
    '00000000-0000-0000-0000-000000000381', // N709 Kobo Aura ONE Limited Edition
    '00000000-0000-0000-0000-000000000382', // N306 Kobo Nia
    '00000000-0000-0000-0000-000000000384', // N873 Kobo Libra H2O
]);

/**
 * Determine whether a parsed device supports Dark mode.
 * Returns 'unsupported' for known older devices (matched by hardware UUID),
 * 'unknown' when there is no device info (e.g. manual mode), and 'supported'
 * otherwise — newer and future devices are assumed to support Dark mode.
 */
function darkModeSupport(deviceInfo) {
    if (!deviceInfo) return 'unknown';
    if (darkModeUnsupportedHardwareIds.has(deviceInfo.hardwareId)) return 'unsupported';
    return 'supported';
}

export { darkModeSupport, darkModeUnsupportedHardwareIds };
