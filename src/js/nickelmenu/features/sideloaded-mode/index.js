// Sideloaded Mode. A Kobo that has been factory reset and never signed into a
// Kobo account can still be used for reading sideloaded books by setting
// SideloadedMode=true under [ApplicationPreferences]. This feature applies that
// one setting and can revert it again — like the better-typography feature, the
// only thing it "owns" is a single Kobo eReader.conf key.
//
// The setting was introduced in Kobo software 4.31, so the feature declares a
// minimumVersion and is gated off on older devices in the config UI.
const SIDELOADED_MODE = { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true' };

export default {
    id: 'sideloaded-mode',
    section: 'Advanced',
    title: 'Enable sideload mode',
    description: 'Sideload Mode lets you use your device without signing into a Kobo account — useful if you factory reset the device and want to read sideloaded books without setting up an account.',
    default: false,
    minimumVersion: '4.31',
    hint: 'Sideloaded Mode lets the Kobo run without a Kobo account. It disables the home screen and opens the device straight to the "My Books" library instead, and it turns off syncing with the Kobo store. Useful after a factory reset when you only read sideloaded books and don\'t want to sign in.',

    // Detected by, and reverted to, the single conf key it manages. Reverting
    // only removes the line when it still matches what we set, so a value the
    // user changed afterwards is never clobbered.
    cleanup: {
        mode: 'optional',
        title: 'Sideloaded Mode',
        removeLabel: 'Turn off Sideloaded Mode',
        description: 'Removes the SideloadedMode setting from your Kobo configuration. If you have not signed in, sign-in may be required again after a reboot.',
        detectConf: [SIDELOADED_MODE],
        revertConf: [{ ...SIDELOADED_MODE, revertTo: null }],
    },

    // Declarative Kobo eReader.conf change, applied by the installer when a
    // device is connected (and shown as a manual instruction otherwise).
    confSettings() {
        return [SIDELOADED_MODE];
    },
};
