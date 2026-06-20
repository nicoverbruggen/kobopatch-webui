import { NM_ITEMS_FILE } from '../constants.js';

/**
 * Shared helpers for NickelMenu features that modify the generated config file.
 */

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
