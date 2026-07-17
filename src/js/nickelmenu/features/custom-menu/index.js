import { darkModeSupport } from '../../../kobo/dark-mode.js';
import { resolveMenuCustomization, NM_MENU_ICON_DEFAULT_PATH } from '../../customization.js';
import { loadBundledAsset } from '../assets.js';

export const CUSTOM_MENU_ICON_URL = new URL('./.cog.png', import.meta.url).href;

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
    section: 'Interface Tweaks',
    title: 'Set up NickelMenu preset',
    description:
        'Adds menu items for dark mode, screenshots, and more. A new tab will be added in the bottom navigation bar. You can customize the icon and label.',
    default: true,
    required: true,
    customization: {
        actionLabel: 'Customize',
        actionAriaLabel: 'Customize NickelMenu preset tab',
    },
    // No per-feature cleanup: everything this feature ships lives under .adds/nm
    // (including the toggle scripts under .adds/nm/scripts), which NickelMenu
    // removal deletes recursively.

    // The preset's Dark Mode item only works on devices whose firmware has a
    // Dark mode setting. On older devices it is left out of the menu (see
    // menuItems) and we surface this notice instead.
    reviewNotices(ctx = {}) {
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') return [];
        const model = ctx.deviceInfo?.model || 'your device';
        return [
            {
                type: 'warning',
                title: 'Dark Mode is not supported',
                paragraphs: [`${model} does not support Dark Mode, so it has been left out of the dot menu (...) for books on this device.`],
                link: {
                    label: 'Kobo documentation on dark mode',
                    href: 'https://help.kobo.com/hc/en-us/articles/360062231213-About-Dark-mode',
                },
            },
        ];
    },

    // Ship the Toggle menu icon.
    async install(ctx = {}) {
        const resolved = resolveMenuCustomization(ctx.menuCustomization);
        if (resolved.iconFile) {
            return [resolved.iconFile];
        }

        const data = ctx.bundledAsset ? await ctx.bundledAsset(CUSTOM_MENU_ICON_URL) : await loadBundledAsset(CUSTOM_MENU_ICON_URL);
        return [{ path: NM_MENU_ICON_DEFAULT_PATH, data }];
    },

    // Contribute the base Toggle-menu entries: the tab header first, then the
    // shared toggles and power items.
    menuItems(ctx = {}) {
        const resolved = resolveMenuCustomization(ctx.menuCustomization);
        const entries = [
            {
                id: 'tweak-header',
                lines: [`experimental :menu_main_15505_label :${resolved.label}`, `experimental :menu_main_15505_icon :/mnt/onboard/${resolved.iconPath}`],
            },
            { id: 'screenshots', lines: ['menu_item :main :Screenshots :nickel_setting :toggle :screenshots'] },
            { id: 'auto-usb', lines: ['menu_item :main :Auto USB :nickel_setting :toggle :auto_usb_gadget'] },
            {
                id: 'rescan-books',
                lines: ['menu_item :library :Rescan books    :nickel_misc        :rescan_books_full'],
            },
            {
                id: 'invert-reboot',
                lines: ['menu_item :main :Invert Display :nickel_setting :toggle: invert', '    chain_success :power :reboot'],
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
