export default {
    id: 'simplify-home',
    title: 'Hide certain home screen elements',
    description: 'If you are reading only one book, no recommendations will appear next to your current read, and third row on your homescreen with advertisements for Kobo Plus and the Kobo Store will be hidden. For minimalists who want fewer distractions.',
    default: false,

    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;

        items.data += '\nexperimental:hide_home_row1col2_enabled:1\nexperimental:hide_home_row3_enabled:1\n';

        return files;
    },
};
