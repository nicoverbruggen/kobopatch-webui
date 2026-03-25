/**
 * Shared helpers for NickelMenu features that modify .adds/nm/items.
 */

/** Create a postProcess function that appends a line to .adds/nm/items. */
export function appendToNmConfig(line) {
    return function postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;
        items.data += '\n' + line + '\n';
        return files;
    };
}

/** Create a postProcess function that prepends a line to .adds/nm/items. */
export function prependToNmConfig(line) {
    return function postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;
        items.data = line + '\n\n' + items.data;
        return files;
    };
}
