// Reading-experience tweaks applied to Kobo eReader.conf. These mirror what the
// "Legibility Toggle" menu script does, but are set up front:
//   - webkitTextRendering=optimizeLegibility enables ligatures/GPOS kerning in
//     kepub books (the WebKit font feature the custom script toggles).
//   - readingAlignment=Left avoids the justified-text wrapping issues that the
//     optimized renderer can introduce.
//   - readingFontFamily=KF Libron is only applied when the additional fonts
//     are part of the install, so we don't point at a font that isn't there.
const ADDITIONAL_FONTS_ID = 'additional-fonts';
const DEFAULT_FONT_FAMILY = 'KF Libron';
const WEBKIT_RENDERING = { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility' };

export default {
    id: 'better-typography',
    section: 'Text and typography',
    title: 'Enable better typography',
    description: 'Turns on Kobo\'s optimized WebKit text rendering for proper ligatures and kerning, and switches reading to left-aligned text to avoid justification wrapping issues. When the additional fonts are also installed, KF Libron is set as the default reading font.',
    default: true,

    // Only the WebKit rendering tweak is owned by this feature for removal — the
    // alignment and reading font are general preferences we don't claw back. The
    // feature is "present" when the WebKit setting is in the conf, and reverting
    // just removes that line (leaving the user's other reading settings alone).
    cleanup: {
        mode: 'optional',
        title: 'Better typography',
        removeLabel: 'Turn off optimized WebKit rendering',
        description: 'Removes the webkitTextRendering setting from Kobo eReader.conf. Your text alignment and reading font are left as they are.',
        detectConf: [WEBKIT_RENDERING],
        revertConf: [{ ...WEBKIT_RENDERING, revertTo: null }],
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
