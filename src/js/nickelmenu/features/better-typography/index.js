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
// "Typography Toggle" Toggle-menu item (it ships the toggle script and inserts
// the menu entry), so the WebKit rendering mode can be flipped later without a
// reconnect. Modelled on the screensaver feature, which likewise owns both an
// asset and its menu item.
export default {
    id: 'better-typography',
    section: 'Text and typography',
    title: 'Enable better typography',
    description: 'Turns on Kobo\'s optimized WebKit text rendering for proper ligatures and kerning, and switches reading to left-aligned text to avoid justification wrapping issues. Also adds an item to the Toggle menu so you can switch this rendering on or off later.',
    default: true,

    // Detection is conf-only (the revertable webkitTextRendering setting). The
    // toggle script is also cleaned up explicitly via cleanup.paths so it's
    // removed regardless of how removal reaches it — the NickelMenu recursive
    // .adds/nm deletion covers it, but having the explicit path makes the
    // removal self-documenting and robust against ordering changes.
    cleanup: {
        mode: 'optional',
        title: 'Better typography',
        removeLabel: 'Turn off better typography',
        description: 'Removes the setting that enables correct kerning and ligatures in certain books, and the Toggle Typography menu script. Your default font and reading settings are not changed.',
        paths: [
            { path: ['.adds', 'nm', 'scripts', 'toggle_typography.sh'] },
        ],
    },

    // Ship the on-device toggle script. install() runs only for selected
    // features, so the script lands exactly when the feature is installed.
    async install(ctx) {
        return [
            { path: '.adds/nm/scripts/toggle_typography.sh', data: await ctx.asset('scripts/toggle_typography.sh') },
        ];
    },

    // Contribute the Toggle-menu toggle that flips optimized WebKit rendering
    // on/off. cmd_output keeps the alert (which states the mode that will be
    // active) on screen for the 7s the script waits before rebooting. menuItems
    // only runs when this feature is selected, so the entry is added exactly when
    // the toggle script is shipped. Its position is set by 'typography' in
    // ../menu-order.js.
    menuItems() {
        return [{
            id: 'typography',
            lines: ['menu_item :main :Toggle Typography :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_typography.sh'],
        }];
    },

    // Declarative Kobo eReader.conf changes, applied by the installer when a
    // device is connected. Receives the selected features so the default font is
    // only set when the additional fonts are actually being installed.
    //
    // `revertable` marks webkitTextRendering as a setting the feature owns for
    // removal: the flow/uninstaller derive detection and revert from it
    // (revertTo: null removes the line). The alignment/font settings carry no
    // such marker — they are general preferences we apply once but never claw back.
    confSettings(ctx = {}) {
        const settings = [
            { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility', revertable: true, revertTo: null },
            { section: 'Reading', key: 'readingAlignment', value: 'Left' },
        ];

        const additionalFontsInstalled = (ctx.features || []).some(f => f.id === 'additional-fonts');
        if (additionalFontsInstalled) {
            settings.push({ section: 'Reading', key: 'readingFontFamily', value: 'KF Libron' });
        }

        return settings;
    },
};
