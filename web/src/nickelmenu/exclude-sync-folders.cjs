const NESTED_DOTFILE_PATTERN = String.raw`([^.][^/]*/)+\\..+`;
const DEFAULT_DOTFOLDER_PATTERN = String.raw`\\.(?!kobo|adobe).+`;
const CALIBRE_DOTFOLDER_PATTERN = String.raw`\\.(?!kobo|adobe|calibre).+`;

const LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINES = Object.freeze({
    default: 'ExcludeSyncFolders=((?!kobo|adobe).+|([^.][^/]*/)+.+)',
    calibre: 'ExcludeSyncFolders=(calibre|(?!kobo|adobe|calibre).+|([^.][^/]*/)+.+)',
});

function buildExcludeSyncFoldersLine({ excludeCalibre = false } = {}) {
    const patterns = excludeCalibre
        ? ['calibre', CALIBRE_DOTFOLDER_PATTERN, NESTED_DOTFILE_PATTERN]
        : [DEFAULT_DOTFOLDER_PATTERN, NESTED_DOTFILE_PATTERN];

    return `ExcludeSyncFolders=(${patterns.join('|')})`;
}

module.exports = {
    buildExcludeSyncFoldersLine,
    LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINES,
};
