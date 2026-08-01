import { loadBundledAsset } from '../Assets.js';

export const SCREENSAVER_MOON_URL = new URL('./moon.png', import.meta.url).href;

// Copies a sample screensaver image to .kobo/screensaver and adds a Toggle-menu
// item that toggles the screensaver on or off (by moving the image between
// .kobo/screensaver and a .disabled/ folder). The user can drop additional
// screensavers into .kobo/screensaver themselves. Removal deletes the sample
// image; like the better-typography feature, this one owns both an asset and
// its menu item.
export default {
    id: 'screensaver',
    section: 'Legacy',
    analyticsEvent: 'add-screensaver',
    title: 'Copy sample screensaver',
    description:
        'Copies a sample screensaver to .kobo/screensaver and adds a new item to the Toggle menu to toggle the screensaver on or off. You can always add extra screensavers in the .kobo/screensaver folder.',
    default: false,

    cleanup: {
        mode: 'optional',
        title: 'Screensaver',
        removeLabel: 'Remove the sample screensaver image',
        description: 'Removes the custom screensaver image (moon.png).',
        detect: [['.kobo', 'screensaver', 'moon.png']],
        paths: [{ path: ['.kobo', 'screensaver', 'moon.png'] }],
    },

    async install(ctx = {}) {
        const data = ctx.bundledAsset ? await ctx.bundledAsset(SCREENSAVER_MOON_URL) : await loadBundledAsset(SCREENSAVER_MOON_URL);
        return [{ path: '.kobo/screensaver/moon.png', data }];
    },

    // The Toggle-menu entry that toggles the screensaver on/off. menuItems only
    // runs when this feature is selected, so the toggle is added exactly when the
    // screensaver image is also installed, and the menu never offers a toggle for
    // a screensaver that isn't there. Its position near the top of the menu is
    // set by 'screensaver' in ../menu-order.js.
    menuItems() {
        return [
            {
                id: 'screensaver',
                lines: [
                    'menu_item :main :Screensaver :cmd_output :500 :quiet :test -e /mnt/onboard/.disabled/screensaver',
                    '      chain_failure : skip : 3',
                    '      chain_success : cmd_spawn : quiet: mkdir -p /mnt/onboard/.disabled && mv /mnt/onboard/.disabled/screensaver /mnt/onboard/.kobo/screensaver',
                    '      chain_success : dbg_toast : Screensaver is now ON.',
                    '      chain_always : skip : -1',
                    '      chain_failure : cmd_spawn : quiet: mkdir -p /mnt/onboard/.disabled && mv /mnt/onboard/.kobo/screensaver /mnt/onboard/.disabled/screensaver',
                    '      chain_success : dbg_toast : Screensaver is now OFF.',
                ],
            },
        ];
    },
};
