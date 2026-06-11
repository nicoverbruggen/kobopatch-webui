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

// This feature alone owns the navigation-tab override, so it also owns the
// Tweak-menu item and script that toggle it on the device — no capability flag
// or custom-menu coordination needed. The script flips the master
// menu_main_15505_enabled switch in the items file and reboots; it lives under
// .adds/nm/scripts so NickelMenu removal's recursive delete cleans it up.
const TABS_TOGGLE_SCRIPT_PATH = '.adds/nm/scripts/toggle_tabs.sh';

// Sits at order 94, alongside the home-content toggle custom-menu may add at 92.
const TABS_TOGGLE = {
    id: 'toggle-tabs',
    order: 94,
    lines: ['menu_item :main :Toggle navigation tabs :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_tabs.sh'],
};

export default {
    id: 'simplify-tabs',
    section: 'Interface tweaks',
    title: 'Simplify navigation tabs',
    description: 'Hides the "My Notebooks" and "Discover" tabs from the bottom navigation tab bar, and this also makes your reading stats available as a separate "Stats" tab.',
    default: false,

    // Ship the on-device toggle script.
    async install(ctx = {}) {
        return [{ path: TABS_TOGGLE_SCRIPT_PATH, data: await ctx.asset('scripts/toggle_tabs.sh') }];
    },

    // Contribute the "Toggle navigation tabs" Tweak item.
    menuItems() {
        return [TABS_TOGGLE];
    },

    postProcess: prependToNmConfig(TAB_CONFIG),
};
