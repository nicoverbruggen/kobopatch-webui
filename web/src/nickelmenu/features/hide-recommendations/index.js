export default {
    id: 'hide-recommendations',
    title: 'Hide home screen recommendations',
    description: 'Hides the recommendations column next to your current read on the home screen. Useful if you are only reading one book at a time.',
    default: false,

    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;

        items.data += '\nexperimental:hide_home_row1col2_enabled:1\n';

        return files;
    },
};
