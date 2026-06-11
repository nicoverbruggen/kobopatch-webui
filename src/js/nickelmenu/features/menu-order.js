// The order of the NickelMenu "Tweak" menu items, top to bottom. This is the
// single source of truth for menu ordering: each feature's `menuItems` entry
// only declares its `id` and `lines`, and the installer positions it by where
// that id appears in this list. To reorder the menu, move an id; to insert an
// item, add its id in the right place — no numbers to juggle.
export const MENU_ITEM_ORDER = [
    'tweak-header',        // custom-menu: the "Tweak" tab header
    'koreader',            // koreader: launch KOReader
    'screensaver',         // screensaver: toggle the screensaver
    'screenshots',         // custom-menu
    'auto-usb',            // custom-menu
    'rescan-books',        // custom-menu
    'typography',          // better-typography: Typography Mode (old Legibility slot)
    'ip-address',          // custom-menu
    'invert-reboot',       // custom-menu
    'sleep',               // custom-menu
    'reboot',              // custom-menu
    'toggle-hidden-home',  // hide-home-content: Show/hide home content
    'toggle-tabs',         // simplify-tabs: Toggle navigation tabs
    'dark-mode',           // custom-menu (reader, supported devices only)
];

// Position of a menu entry's id within the menu. Throws on an unknown id — a
// contributed entry with no declared position is a bug we want surfaced loudly
// rather than silently dropped to the bottom.
export function menuItemPosition(id) {
    const index = MENU_ITEM_ORDER.indexOf(id);
    if (index === -1) {
        throw new Error(`NickelMenu menu item "${id}" is not listed in MENU_ITEM_ORDER`);
    }
    return index;
}
