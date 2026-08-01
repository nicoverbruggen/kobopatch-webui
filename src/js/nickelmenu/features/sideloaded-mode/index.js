import { NM_ITEMS_FILE } from '../../Constants.js';

// Sideload Mode. A Kobo that has been factory reset and never signed into a
// Kobo account can still be used for reading sideloaded books by setting
// SideloadedMode=true under [ApplicationPreferences]. This feature applies that
// one setting and can revert it again — like the better-typography feature, the
// only thing it "owns" is a single Kobo eReader.conf key.
//
// The setting was introduced in Kobo software 4.31, so the feature declares a
// minimumVersion and is gated off on older devices in the config UI.
export default {
    id: 'sideloaded-mode',
    section: 'Advanced',
    analyticsEvent: 'add-sideloaded-mode',
    title: 'Enable Sideload Mode',
    description:
        'Sideload Mode lets you use your device without signing into a Kobo account — useful if you factory reset the device and want to read sideloaded books without setting up an account.',
    default: false,
    minimumVersion: '4.31',
    hint: 'Sideload Mode lets the Kobo run without a Kobo account. It disables the home screen and opens the device straight to the "My Books" library instead, and it turns off syncing with the Kobo store. Useful after a factory reset when you only read sideloaded books and don\'t want to sign in.',

    // Surface what Sideload Mode does at the review step, so the behavior
    // change is hard to miss before writing it. No outbound link — the
    // explanation is self-contained.
    reviewNotices() {
        return [
            {
                type: 'warning',
                title: 'Sideload Mode changes how your Kobo works',
                paragraphs: [
                    'With Sideload Mode on, the device skips the home screen and opens straight to your "My Books" library, the Home tab is hidden, and syncing with the Kobo store is turned off.',
                    'This is meant for a Kobo used without a Kobo account (for example after a factory reset). To switch it back off, remove NickelMenu with this tool — it offers to revert the setting during removal — after which the device may ask you to sign in.',
                ],
            },
        ];
    },

    // Cleanup only carries the removal presentation here — detection and revert
    // are derived from the revertable SIDELOADED_MODE conf setting above.
    // Reverting only removes the line when it still matches what we set, so a
    // value the user changed afterwards is never overwritten.
    cleanup: {
        mode: 'optional',
        title: 'Sideload Mode',
        removeLabel: 'Turn off Sideload Mode',
        description: 'If you did not previously sign in, sign-in may be required again after your device reboots.',
    },

    // Hide the home navigation tab by commenting out its force-enable override.
    // That override (experimental:menu_main_15505_0_enabled, the home tab at
    // index 0 of the bottom tab bar) is added by simplify-tabs; in Sideload Mode
    // there is no home screen, so it must be removed for the home tab to
    // disappear. We comment it out rather than delete it — and leave an
    // explanatory note above it — so re-running the build without this feature
    // regenerates the items file with the line restored. A no-op when the line
    // isn't present: without it Sideload Mode already hides the home tab on its own.
    postProcess(files) {
        const items = files.find((f) => f.path === NM_ITEMS_FILE);
        if (!items || typeof items.data !== 'string') return files;

        const homeTabPattern = /^\s*experimental\s*:\s*menu_main_15505_0_enabled\b/;
        items.data = items.data
            .split('\n')
            .flatMap((line) =>
                homeTabPattern.test(line) && !line.trimStart().startsWith('#')
                    ? ['# Home tab hidden for Sideload Mode (no home screen when not signed in).', '# ' + line]
                    : [line],
            )
            .join('\n');
        return files;
    },

    // Declarative Kobo eReader.conf change, applied by the installer when a
    // device is connected (and shown as a manual instruction otherwise).
    // `revertable` marks the one conf key this feature owns: the flow/uninstaller
    // derive detection and revert from it (revertTo: null removes the line on
    // removal, and only when it still matches what we set).
    confSettings() {
        return [
            {
                section: 'ApplicationPreferences',
                key: 'SideloadedMode',
                value: 'true',
                revertable: true,
                revertTo: null,
            },
        ];
    },
};
