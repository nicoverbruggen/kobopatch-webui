/**
 * sync-exclusions.js — Builds the `ExcludeSyncFolders` regex value.
 *
 * Assembles the Kobo eReader.conf ExcludeSyncFolders line from its component
 * patterns (dotfolders, nested dotfiles, optional calibre exclusion). Pure
 * string construction; parsing/validation of an existing line lives in
 * configuration.js.
 */

const nestedDotfilePattern = String.raw`([^.][^/]*/)+\\..+`;
const defaultDotfolderPattern = String.raw`\\.(?!kobo|adobe).+`;
const calibreDotfolderPattern = String.raw`\\.(?!kobo|adobe|calibre).+`;

const legacyBrokenExcludeSyncFoldersLines = Object.freeze({
    default: 'ExcludeSyncFolders=((?!kobo|adobe).+|([^.][^/]*/)+.+)',
    calibre: 'ExcludeSyncFolders=(calibre|(?!kobo|adobe|calibre).+|([^.][^/]*/)+.+)',
});

function buildExcludeSyncFoldersLine({ excludeCalibre = false } = {}) {
    const patterns = excludeCalibre ? ['calibre', calibreDotfolderPattern, nestedDotfilePattern] : [defaultDotfolderPattern, nestedDotfilePattern];

    return `ExcludeSyncFolders=(${patterns.join('|')})`;
}

export { buildExcludeSyncFoldersLine, legacyBrokenExcludeSyncFoldersLines };
