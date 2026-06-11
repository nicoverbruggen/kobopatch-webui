// The order of the NickelMenu "Tweak" menu items, top to bottom. This is the
// single source of truth for menu ordering: each feature's `menuItems` entry
// only declares its `id` and `lines`, and the installer positions it by where
// that id appears in this list. To reorder the menu, move an id; to insert an
// item, add its id in the right place — no numbers to juggle.
export const MENU_ITEM_ORDER = [
    'tweak-header',        // custom-menu: the "Tweak" tab header
    'koreader',            // koreader: Open KOReader
    'screenshots',         // custom-menu: Toggle Screenshots
    'screensaver',         // screensaver: Toggle Screensaver (below Screenshots)
    'auto-usb',            // custom-menu: Toggle Auto USB
    'typography',          // better-typography: Toggle Typography
    'toggle-hidden-home',  // hide-home-content: Toggle Minimal Home
    'toggle-tabs',         // simplify-tabs: Toggle Simple Tabs
    'invert-reboot',       // custom-menu: Invert Display
    'sleep',               // custom-menu: Sleep Device
    'reboot',              // custom-menu: Reboot Device
    // Rescan books (:library) and Dark Mode (:reader) live in other NickelMenu
    // sections, so their position among the :main items is irrelevant — pinned
    // at the bottom.
    'rescan-books',        // custom-menu
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
