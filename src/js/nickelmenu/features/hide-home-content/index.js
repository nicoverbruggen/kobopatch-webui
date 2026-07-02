import { appendToNmConfig } from '../helpers.js';
import { loadBundledAsset } from '../assets.js';

export const TOGGLE_HIDDEN_HOME_SCRIPT_URL = new URL('./scripts/toggle_hidden_home.sh', import.meta.url).href;

// The home-screen hiders are near-identical: each one appends a single
// experimental:hide_home_*_enabled:1 line and shares ONE on-device toggle — the
// "Minimal Home" Toggle-menu item plus a script that flips every
// hide_home_*_enabled flag at once. Rather than repeat that across three feature
// files behind a capability flag custom-menu has to scan for, we generate the
// features from a table below. Each generated feature owns the shared toggle, and
// the installer de-duplicates the identical menu item (by id) and script (by
// path) so it appears exactly once regardless of how many hiders are selected.

function makeHider({ id, title, description, flag }) {
    return {
        id,
        section: 'Interface Tweaks',
        title,
        description,
        default: false,

        // Ship the shared toggle script (de-duplicated by path in the installer,
        // so it lands once however many hiders are selected). It goes under
        // .adds/nm/scripts so NickelMenu removal's recursive delete cleans it up.
        // The Vite-tracked URL goes through the installer's per-run asset cache,
        // so the script is fetched exactly once even when several hiders are selected.
        async install(ctx = {}) {
            const data = ctx.bundledAsset ? await ctx.bundledAsset(TOGGLE_HIDDEN_HOME_SCRIPT_URL) : await loadBundledAsset(TOGGLE_HIDDEN_HOME_SCRIPT_URL);
            return [{ path: '.adds/nm/scripts/toggle_hidden_home.sh', data }];
        },

        // Contribute the shared Toggle item. Every hider returns this identical
        // entry and the installer collapses the duplicates (by id); its position
        // (after the power items) is set by 'toggle-hidden-home' in ../menu-order.js.
        menuItems() {
            return [
                {
                    id: 'toggle-hidden-home',
                    lines: ['menu_item :main :Minimal Home :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_hidden_home.sh'],
                },
            ];
        },

        // Append this hider's experimental flag to the assembled items file.
        postProcess: appendToNmConfig(`experimental:${flag}:1`),
    };
}

const HIDERS = [
    {
        id: 'hide-recommendations',
        title: 'Hide home screen recommendations',
        description: 'Hides the recommendations next to your current read on the home screen.',
        flag: 'hide_home_row1col2_enabled',
    },
    {
        id: 'hide-row2col2',
        title: 'Hide suggestions next to My Books',
        description: 'Hides the suggestions shown next to My Books on the second row of the home screen.',
        flag: 'hide_home_row2col2_enabled',
    },
    {
        id: 'hide-notices',
        title: 'Hide home screen notices',
        description:
            'Hides the third row on the home screen that shows notices below your books, such as reading time, release notes for updates, and Kobo Plus or Store promotions.',
        flag: 'hide_home_row3_enabled',
    },
];

export const homeHiders = HIDERS.map(makeHider);
