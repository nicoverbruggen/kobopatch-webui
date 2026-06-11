import { darkModeSupport } from '../../../kobo/dark-mode.js';

// The base Tweak-menu entries, owned by this feature. The NickelMenu `items`
// file is no longer a static asset: each entry below is a data structure, and
// the installer collects entries from every selected feature (via `menuItems`),
// orders them by their id's position in MENU_ITEM_ORDER (see ../menu-order.js),
// and renders the file. Device-conditional items become a simple "don't include
// this entry" instead of commenting out matched lines.
const HEADER = {
    id: 'tweak-header',
    lines: [
        'experimental :menu_main_15505_label :Tweak',
        'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
    ],
};

const BASE_ITEMS = [
    HEADER,
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
// setting. On older devices we leave it out entirely (and surface the warning in
// reviewNotices); previously it was shipped commented-out.
const DARK_MODE = {
    id: 'dark-mode',
    lines: ['menu_item :reader :Dark Mode        :nickel_setting     :toggle :dark_mode'],
};

// The toggle items for hidden home content and navigation tabs are owned by the
// features that hide those things (hide-home-content and simplify-tabs), each of
// which contributes its own menuItems entry and ships its own .adds/nm/scripts
// script. custom-menu only owns the base Tweak menu below.

const customMenu = {
    id: 'custom-menu',
    section: 'Interface tweaks',
    title: 'Set up NickelMenu preset',
    description: 'Adds menu items for dark mode, screenshots, and more. A new tab will be added in the bottom navigation that is labelled "Tweak".',
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

    // Ship the Tweak menu icon.
    async install(ctx = {}) {
        return [
            { path: '.adds/nm/.cog.png', data: await ctx.asset('.cog.png') },
        ];
    },

    // Contribute the base Tweak-menu entries. Dark Mode is dropped on unsupported
    // devices (left out of the menu entirely rather than commented out).
    menuItems(ctx = {}) {
        const entries = [...BASE_ITEMS];
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') {
            entries.push(DARK_MODE);
        }
        return entries;
    },
};

export default customMenu;
