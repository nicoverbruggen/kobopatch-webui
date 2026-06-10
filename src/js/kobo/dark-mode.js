/**
 * Serial prefixes for older Kobo eReaders that do NOT support Dark mode.
 * Source: https://help.kobo.com/hc/en-us/articles/360062231213-About-Dark-mode
 *
 * This is kept as a blacklist of older devices rather than an allowlist of
 * supported ones: Dark mode is standard on current hardware, so future models
 * are assumed to support it unless proven otherwise.
 */
const darkModeUnsupportedModels = new Set([
    'N306', // Kobo Nia
    'N873', // Kobo Libra H2O
    'N782', // Kobo Forma
    'N249', // Kobo Clara HD
    'N867', // Kobo Aura H2O Edition 2
    'N709', // Kobo Aura ONE
    'N236', // Kobo Aura Edition 2
    'N587', // Kobo Touch 2.0
    'N437', // Kobo Glo HD
    'N250', // Kobo Aura H2O
    'N514', // Kobo Aura
    'N613', // Kobo Glo
    'N705', // Kobo Mini
    'N416', // Kobo Original
    'N905', // Kobo Touch
    'N647', // Kobo Wireless
    'N47B', // Kobo Wireless
    'N204', // Kobo Aura HD
]);

/**
 * Determine whether a parsed device supports Dark mode.
 * Returns 'unsupported' for known older devices, 'unknown' when there is no
 * device info (e.g. manual mode), and 'supported' otherwise — newer and future
 * devices are assumed to support Dark mode.
 */
function darkModeSupport(deviceInfo) {
    if (!deviceInfo) return 'unknown';
    if (darkModeUnsupportedModels.has(deviceInfo.serialPrefix)) return 'unsupported';
    return 'supported';
}

export { darkModeSupport, darkModeUnsupportedModels };
