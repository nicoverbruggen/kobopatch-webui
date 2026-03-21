export default {
    id: 'simplify-tabs',
    title: 'Hide certain navigation tabs',
    description: 'This will hide the Notebook and Discover tabs from the bottom navigation. For minimalists who want fewer distractions.',
    default: false,

    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;

        // Uncomment the experimental tab-customization lines
        items.data = items.data.split('\n').map(line => {
            if (line.startsWith('#experimental ')) {
                return line.slice(1); // remove leading #
            }
            return line;
        }).join('\n');

        return files;
    },
};
