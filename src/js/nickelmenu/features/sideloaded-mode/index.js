// Sideload mode. A Kobo that has been factory reset and never signed into a
// Kobo account can still be used for reading sideloaded books by setting
// SideloadedMode=true under [ApplicationPreferences]. This feature applies that
// one setting and can revert it again — like the better-typography feature, the
// only thing it "owns" is a single Kobo eReader.conf key.
//
// The setting was introduced in Kobo software 4.31, so the feature declares a
// minimumVersion and is gated off on older devices in the config UI.
const SIDELOADED_MODE = { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true' };

// The NickelMenu items line that force-enables the home navigation tab (index 0
// of the bottom tab bar). The simplify-tabs feature adds it. In Sideload mode
// there is no home screen, so this override must be removed for the home tab to
// disappear — we comment it out rather than delete it, so it can be restored if
// the build is re-run without Sideload mode (or simply not selected at all).
const HOME_TAB_PATTERN = /^\s*experimental\s*:\s*menu_main_15505_0_enabled\b/;

// Comment out the home-tab override (if present and not already commented),
// leaving an explanatory note above it. Re-running the build without this
// feature regenerates the items file with the line restored.
function hideHomeTab(items) {
    return items
        .split('\n')
        .flatMap(line =>
            HOME_TAB_PATTERN.test(line) && !line.trimStart().startsWith('#')
                ? ['# Home tab hidden for Sideload mode (no home screen when not signed in).', '# ' + line]
                : [line]
        )
        .join('\n');
}

export default {
    id: 'sideloaded-mode',
    section: 'Advanced',
    title: 'Enable Sideload mode',
    description: 'Sideload mode lets you use your device without signing into a Kobo account — useful if you factory reset the device and want to read sideloaded books without setting up an account.',
    default: false,
    minimumVersion: '4.31',
    hint: 'Sideload mode lets the Kobo run without a Kobo account. It disables the home screen and opens the device straight to the "My Books" library instead, and it turns off syncing with the Kobo store. Useful after a factory reset when you only read sideloaded books and don\'t want to sign in.',

    // Detected by, and reverted to, the single conf key it manages. Reverting
    // only removes the line when it still matches what we set, so a value the
    // user changed afterwards is never clobbered.
    cleanup: {
        mode: 'optional',
        title: 'Sideload mode',
        removeLabel: 'Turn off Sideload mode',
        description: 'If you did not previously sign in, sign-in may be required again after your device reboots.',
        detectConf: [SIDELOADED_MODE],
        revertConf: [{ ...SIDELOADED_MODE, revertTo: null }],
    },

    // Surface what Sideload mode does at the review step, so the behavior
    // change is hard to miss before writing it. No outbound link — the
    // explanation is self-contained.
    reviewNotices() {
        return [{
            type: 'warning',
            title: 'Sideload mode changes how your Kobo works',
            paragraphs: [
                'With Sideload mode on, the device skips the home screen and opens straight to your "My Books" library, the Home tab is hidden, and syncing with the Kobo store is turned off.',
                'This is meant for a Kobo used without a Kobo account (for example after a factory reset). To switch it back off, remove NickelMenu with this tool — it offers to revert the setting during removal — after which the device may ask you to sign in.',
            ],
        }];
    },

    // Hide the home navigation tab by commenting out its force-enable override
    // (added by simplify-tabs). A no-op when that line isn't present — without it
    // Sideload mode already hides the home tab on its own.
    postProcess(files) {
        const items = files.find(f => f.path === '.adds/nm/items');
        if (!items || typeof items.data !== 'string') return files;
        items.data = hideHomeTab(items.data);
        return files;
    },

    // Declarative Kobo eReader.conf change, applied by the installer when a
    // device is connected (and shown as a manual instruction otherwise).
    confSettings() {
        return [SIDELOADED_MODE];
    },
};
