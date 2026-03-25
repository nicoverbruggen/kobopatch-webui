import { prependToNmConfig } from '../helpers.js';

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
    title: 'Simplify navigation tabs',
    description: 'Hides the "My Notebooks" and "Discover" tabs from the bottom navigation tab bar.',
    default: false,

    postProcess: prependToNmConfig(TAB_CONFIG),
};
