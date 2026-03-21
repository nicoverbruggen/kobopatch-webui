const TAB_CONFIG = [
    'experimental :menu_main_15505_0_enabled: 1',
    'experimental :menu_main_15505_1_label: Books',
    'experimental :menu_main_15505_2_enabled: 1',
    'experimental :menu_main_15505_2_label: Stats',
    'experimental :menu_main_15505_3_enabled: 0',
    'experimental :menu_main_15505_3_label: Notes',
    'experimental :menu_main_15505_4_enabled: 0',
    'experimental :menu_main_15505_5_enabled: 1',
    'experimental :menu_main_15505_default: 1',
    'experimental :menu_main_15505_enabled: 1',
].join('\n');

export default {
    id: 'simplify-tabs',
    title: 'Hide certain navigation tabs',
    description: 'This will hide the Notebook and Discover tabs from the bottom navigation. For minimalists who want fewer distractions.',
    default: false,

    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;

        items.data = TAB_CONFIG + '\n\n' + items.data;

        return files;
    },
};
