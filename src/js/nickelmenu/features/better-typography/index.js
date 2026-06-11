// Reading-experience tweaks applied to Kobo eReader.conf. These mirror what the
// "Typography Toggle" menu script does, but are set up front:
//   - webkitTextRendering=optimizeLegibility enables ligatures/GPOS kerning in
//     kepub books (the WebKit font feature the toggle script flips).
//   - readingAlignment=Left avoids the justified-text wrapping issues that the
//     optimized renderer can introduce.
//   - readingFontFamily=KF Libron is only applied when the additional fonts
//     are part of the install, so we don't point at a font that isn't there.
//
// On top of those one-time settings, this feature also folds in the on-device
// "Typography Toggle" Tweak-menu item (it ships the toggle script and inserts
// the menu entry), so the WebKit rendering mode can be flipped later without a
// reconnect. Modelled on the screensaver feature, which likewise owns both an
// asset and its menu item.
const ADDITIONAL_FONTS_ID = 'additional-fonts';
const DEFAULT_FONT_FAMILY = 'KF Libron';
const WEBKIT_RENDERING = { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility' };

const TOGGLE_SCRIPT_PATH = '.adds/scripts/toggle_typography.sh';

// The Tweak-menu entry that toggles optimized WebKit rendering on/off. cmd_output
// keeps the alert (which states the mode that will be active) on screen for the
// 7s the script waits before rebooting. Added only when this feature is
// installed, so the menu never offers a toggle for a setting that isn't managed.
const TYPOGRAPHY_MENU_ITEM = 'menu_item :main :Typography Mode    :cmd_output :7000 :/mnt/onboard/.adds/scripts/toggle_typography.sh';

// The item is inserted right after the Tweak menu header so it sits near the top
// of the menu, matching how the screensaver toggle positions itself.
const MENU_HEADER_PATTERN = /^experimental :menu_main_15505_icon\b/;

export default {
    id: 'better-typography',
    section: 'Text and typography',
    title: 'Enable better typography',
    description: 'Turns on Kobo\'s optimized WebKit text rendering for proper ligatures and kerning, and switches reading to left-aligned text to avoid justification wrapping issues. Also adds an item to the Tweak menu so you can switch this rendering on or off later.',
    default: true,

    // The WebKit rendering setting and the toggle script are owned by this
    // feature for removal — the alignment and reading font are general
    // preferences we don't claw back. The feature is "present" when either the
    // WebKit setting is in the conf or the toggle script is on the device (the
    // toggle can turn the conf line off while leaving the script in place), and
    // reverting removes that line and the script.
    cleanup: {
        mode: 'optional',
        title: 'Better typography',
        removeLabel: 'Turn off better typography',
        description: 'Removes the setting that enables correct kerning and ligatures in certain books, and the Typography Mode menu script. Your default font and reading settings are not changed.',
        detect: [['.adds', 'scripts', 'toggle_typography.sh']],
        detectConf: [WEBKIT_RENDERING],
        paths: [
            { path: ['.adds', 'scripts', 'toggle_typography.sh'] },
        ],
        removeParentDirsIfEmpty: [['.adds', 'scripts']],
        revertConf: [{ ...WEBKIT_RENDERING, revertTo: null }],
    },

    // Ship the on-device toggle script. install() runs only for selected
    // features, so the script lands exactly when the feature is installed.
    async install(ctx) {
        return [
            { path: TOGGLE_SCRIPT_PATH, data: await ctx.asset('scripts/toggle_typography.sh') },
        ];
    },

    // Insert the Tweak-menu toggle. postProcess only runs when this feature is
    // selected, and the items file is always present alongside it (the preset's
    // required custom-menu ships it), so the entry is added exactly once.
    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;

        const lines = items.data.split('\n');
        const headerIndex = lines.findIndex(line => MENU_HEADER_PATTERN.test(line));
        const insertAt = headerIndex === -1 ? lines.length : headerIndex + 1;
        lines.splice(insertAt, 0, '', TYPOGRAPHY_MENU_ITEM);
        items.data = lines.join('\n');

        return files;
    },

    // Declarative Kobo eReader.conf changes, applied by the installer when a
    // device is connected. Receives the selected features so the default font is
    // only set when the additional fonts are actually being installed.
    confSettings(ctx = {}) {
        const settings = [
            WEBKIT_RENDERING,
            { section: 'Reading', key: 'readingAlignment', value: 'Left' },
        ];

        const additionalFontsInstalled = (ctx.features || []).some(f => f.id === ADDITIONAL_FONTS_ID);
        if (additionalFontsInstalled) {
            settings.push({ section: 'Reading', key: 'readingFontFamily', value: DEFAULT_FONT_FAMILY });
        }

        return settings;
    },
};
