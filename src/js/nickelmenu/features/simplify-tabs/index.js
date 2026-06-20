import { prependToNmConfig } from '../helpers.js';

// Simplifies the bottom navigation tab bar: hides the "My Notebooks" and
// "Discover" tabs and surfaces reading stats as a separate "Stats" tab. This
// feature alone owns the navigation-tab override, so it also owns the Toggle-menu
// item and script that toggle it on the device — no capability flag or
// custom-menu coordination needed. The script comments or uncomments the tab
// override lines in the items file and reboots; it lives under .adds/nm/scripts
// so NickelMenu removal's recursive delete cleans it up.
export default {
    id: 'simplify-tabs',
    section: 'Interface tweaks',
    title: 'Simplify navigation tabs',
    description:
        'Hides the "My Notebooks" and "Discover" tabs from the bottom navigation tab bar, and this also makes your reading stats available as a separate "Stats" tab.',
    default: false,

    // Ship the on-device toggle script.
    async install(ctx = {}) {
        return [{ path: '.adds/nm/scripts/toggle_tabs.sh', data: await ctx.asset('scripts/toggle_tabs.sh') }];
    },

    // Contribute the "Simple Tabs" Toggle-menu item. Its position (just after
    // the home-content toggle) is set by 'toggle-tabs' in ../menu-order.js.
    menuItems() {
        return [
            {
                id: 'toggle-tabs',
                lines: ['menu_item :main :Simple Tabs :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_tabs.sh'],
            },
        ];
    },

    // Prepend the navigation-tab override to the assembled items file.
    postProcess: prependToNmConfig(
        [
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
        ].join('\n'),
    ),
};
