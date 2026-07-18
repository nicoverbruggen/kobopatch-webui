// Keeps books in a "calibre" folder out of the Kobo library by adding a
// `calibre` alternation to the ExcludeSyncFolders regex. Pure config: the only
// thing it owns is that one Kobo eReader.conf line (see installer.js), so it
// declares no install/menuItems/cleanup of its own.
export default {
    id: 'exclude-calibre',
    section: 'Legacy',
    analyticsEvent: 'add-exclude-calibre',
    title: 'Prevent Calibre books from appearing in My Books',
    description:
        'Prevents new books in the "calibre" folder from being detected and added to "My Books". This only works for books stored in a "calibre" folder, so move Calibre-transferred books there first if you want to keep them separate from purchased books. If you are also installing KOReader, this might be useful, otherwise keep this unchecked.',
    default: false,
};
