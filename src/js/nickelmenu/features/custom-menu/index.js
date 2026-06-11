import { darkModeSupport } from '../../../kobo/dark-mode.js';

// Sets up the "Toggle" tab and its base NickelMenu entries (the tab header, plus
// screenshots, auto-USB, rescan, invert, sleep, reboot, and a device-conditional
// Dark Mode item). The NickelMenu config file is not a static asset: every
// selected feature contributes its entries via `menuItems`, and the installer
// orders them by their id's position in MENU_ITEM_ORDER (see ../menu-order.js)
// and renders the file. Device-conditional items are simply left out rather than
// commented. The toggle items for hidden home content and navigation tabs are
// owned by the features that hide those things (hide-home-content and
// simplify-tabs); custom-menu only owns the base Toggle menu.
export default {
    id: 'custom-menu',
    section: 'Interface tweaks',
    title: 'Set up NickelMenu preset',
    description: 'Adds menu items for dark mode, screenshots, and more. A new tab will be added in the bottom navigation that is labelled "Toggle".',
    default: true,
    required: true,
    // No per-feature cleanup: everything this feature ships lives under .adds/nm
    // (including the toggle scripts under .adds/nm/scripts), which NickelMenu
    // removal deletes recursively.

    // The preset's Dark Mode item only works on devices whose firmware has a
    // Dark mode setting. On older devices it is left out of the menu (see
    // menuItems) and we surface this notice instead.
    reviewNotices(ctx = {}) {
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') return [];
        const model = ctx.deviceInfo?.model || 'your device';
        return [{
            type: 'warning',
            title: 'Dark Mode is not supported',
            paragraphs: [
                `${model} does not support Dark Mode, so it has been left out of the (...) menu for books on this device.`,
            ],
            link: {
                label: 'Kobo documentation on dark mode',
                href: 'https://help.kobo.com/hc/en-us/articles/360062231213-About-Dark-mode',
            },
        }];
    },

    // Ship the Toggle menu icon.
    async install(ctx = {}) {
        return [
            { path: '.adds/nm/.cog.png', data: await ctx.asset('.cog.png') },
        ];
    },

    // Contribute the base Toggle-menu entries: the tab header first, then the
    // shared toggles and power items.
    menuItems(ctx = {}) {
        const entries = [
            {
                id: 'tweak-header',
                lines: [
                    'experimental :menu_main_15505_label :Toggle',
                    'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
                ],
            },
            { id: 'screenshots', lines: ['menu_item :main :Toggle Screenshots :nickel_setting :toggle :screenshots'] },
            { id: 'auto-usb', lines: ['menu_item :main :Toggle Auto USB :nickel_setting :toggle :auto_usb_gadget'] },
            { id: 'rescan-books', lines: ['menu_item :library :Rescan books    :nickel_misc        :rescan_books_full'] },
            {
                id: 'invert-reboot',
                lines: [
                    'menu_item :main :Invert Display :nickel_setting :toggle: invert',
                    '    chain_success :power :reboot',
                ],
            },
            { id: 'sleep', lines: ['menu_item :main :Sleep Device :power :sleep'] },
            { id: 'reboot', lines: ['menu_item :main :Reboot Device :power :reboot'] },
        ];

        // The Dark Mode item only works on devices whose firmware has a Dark mode
        // setting. On unsupported devices it is left out of the menu entirely
        // (and the warning is surfaced in reviewNotices) rather than shipped
        // commented-out.
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') {
            entries.push({
                id: 'dark-mode',
                lines: ['menu_item :reader :Dark Mode        :nickel_setting     :toggle :dark_mode'],
            });
        }

        return entries;
    },
};
