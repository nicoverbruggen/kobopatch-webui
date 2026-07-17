import { NM_ITEMS_FILE, NICKELHOME_CONFIG_FILE } from '../constants.js';

/**
 * Shared helpers for NickelMenu features that modify the generated config file.
 */

const NICKELHOME_CONFIG_HEADER =
    '# NickelHome configuration, written by KoboPatch Web UI.\n' +
    '# Each hide_home_*_enabled:1 line hides one home-screen widget. The "Minimal Home"\n' +
    '# NickelMenu item flips the nhm_enabled master switch below to show/hide them all at\n' +
    '# once while keeping your selection. Reboot for changes to apply.\n' +
    '\n' +
    'nhm_enabled:1\n';

/**
 * Create a postProcess function that adds a line to NickelHome's own config file
 * (.adds/nickel-home/config). The file is created on first use with a short header
 * and shared by every home-content hider, so all the selected hide_home_* flags land
 * in the one config NickelHome reads at boot. Writing this file also prevents NickelHome
 * from seeding its hide-everything default template on first run.
 */
export function appendToNickelHomeConfig(line) {
    return function postProcess(files) {
        let cfg = files.find((f) => f.path === NICKELHOME_CONFIG_FILE);
        if (!cfg) {
            cfg = { path: NICKELHOME_CONFIG_FILE, data: NICKELHOME_CONFIG_HEADER };
            files.push(cfg);
        }
        if (typeof cfg.data !== 'string') return files;
        cfg.data += line + '\n';
        return files;
    };
}

/** Create a postProcess function that appends a line to the config. */
export function appendToNmConfig(line) {
    return function postProcess(files) {
        const items = files.find((f) => f.path === NM_ITEMS_FILE);
        if (!items || typeof items.data !== 'string') return files;
        items.data += '\n' + line + '\n';
        return files;
    };
}

/** Create a postProcess function that prepends a line to the config. */
export function prependToNmConfig(line) {
    return function postProcess(files) {
        const items = files.find((f) => f.path === NM_ITEMS_FILE);
        if (!items || typeof items.data !== 'string') return files;
        items.data = line + '\n\n' + items.data;
        return files;
    };
}
