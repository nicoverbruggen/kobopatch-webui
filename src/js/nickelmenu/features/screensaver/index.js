// The Tweak-menu entry that toggles the screensaver on/off. Contributed to the
// NickelMenu items file only when this feature is installed, so the menu never
// offers a toggle for a screensaver that isn't there. Order 10 keeps it near the
// top of the menu, its original position.
const SCREENSAVER_MENU_ITEM = [
    'menu_item :main :Screensaver :cmd_output :500 :quiet :test -e /mnt/onboard/.disabled/screensaver',
    '      chain_failure : skip : 3',
    '      chain_success : cmd_spawn : quiet: mkdir -p /mnt/onboard/.disabled && mv /mnt/onboard/.disabled/screensaver /mnt/onboard/.kobo/screensaver',
    '      chain_success : dbg_toast : Screensaver is now ON.',
    '      chain_always : skip : -1',
    '      chain_failure : cmd_spawn : quiet: mkdir -p /mnt/onboard/.disabled && mv /mnt/onboard/.kobo/screensaver /mnt/onboard/.disabled/screensaver',
    '      chain_success : dbg_toast : Screensaver is now OFF.',
];

export default {
    id: 'screensaver',
    section: 'Advanced',
    title: 'Copy sample screensaver',
    description: 'Copies a sample screensaver to .kobo/screensaver and adds a new item to the Tweak menu to toggle the screensaver on or off. You can always add extra screensavers in the .kobo/screensaver folder.',
    default: false,

    cleanup: {
        mode: 'optional',
        title: 'Screensaver',
        removeLabel: 'Remove the sample screensaver image',
        description: 'Removes the custom screensaver image (moon.png).',
        detect: [['.kobo', 'screensaver', 'moon.png']],
        paths: [
            { path: ['.kobo', 'screensaver', 'moon.png'] },
        ],
    },

    async install(ctx) {
        return [
            { path: '.kobo/screensaver/moon.png', data: await ctx.asset('moon.png') },
        ];
    },

    // menuItems only runs when this feature is selected, so the toggle is added
    // exactly when the screensaver image is also installed.
    menuItems() {
        return [{ id: 'screensaver', order: 10, lines: SCREENSAVER_MENU_ITEM }];
    },
};
