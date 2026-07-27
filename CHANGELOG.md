# Changelog

> This changelog is for the upcoming release. When a release is tagged, the list can be emptied.

### What's new

- The "Install additional fonts" option now ships the full [ebook-fonts](https://github.com/nicoverbruggen/ebook-fonts) collection (Kobo-optimized KF builds) and has a "Select fonts" button: a dialog lists every font family with a rendered type specimen below each name, grouped into the curated core set (selected by default) and the larger extra set, so you can pick exactly which families are installed. Only the archives your selection needs are downloaded. The previous bundled fonts (Readerly, Libron, Cartisse) are part of the collection, so existing installs are still detected and can be removed or upgraded.

- The "Better typography and fixes" option installs [NickelTypeFix](https://github.com/nicoverbruggen/NickelTypeFix) whenever the asset is bundled, repairing the text-rendering quirks the optimized renderer would otherwise expose (uneven justification and vertical CJK text) and fixing glyph "wobble" on unhinted fonts. Turning off Better typography and fixes during removal also removes the mod when present.
- Two new mods joined the NickelMenu options, and both are offered for removal when detected: [NickelDissolve](https://github.com/nicoverbruggen/NickelDissolve) (experimental) adds a Kindle-style wipe animation to page turns and can be found under "Reading Experience". It is only offered on its supported devices (Kobo Libra Colour, Clara Colour, Clara BW), and when the device cannot be identified (manual mode) it remains available and stays inert on unsupported hardware; and [NickelCoverFix](https://github.com/nicoverbruggen/NickelCoverFix) keeps book covers from turning into the title/author placeholder and supports custom covers. (The latter will become available later and is currently hidden.)
- The NickelMenu feature list is easier to scan: each section has an icon, the reading apps (KOReader, Cadmus) now live in a collapsible "Alternative reading apps" section, and the older "Legacy" options are de-emphasized in grey.
- The "Simplify Tabs" option now has a Customize button. It opens a dialog with a live preview of the bottom navigation bar where you can choose which tabs are shown (Stats, My Notebooks, Discover) and rename the Books, Stats, and Notes tabs.

### What's changed

- Home-screen tweaks now install the standalone NickelHome mod alongside the standard NickelMenu, instead of relying on a NickelMenu fork. If your Kobo was set up with an older version of this tool, reinstalling updates NickelMenu to the standard version.
- Removed the "NickelMenu only" (barebones) install option. Installing now always sets up the curated preset, which you can still fully customize.
- The first screen has been updated to provide you with some more information on how to get started.
- The language of your device is now taken into account for the "Simplify Tabs" functionality. The custom menu remains in English.
- Add-ons that are still experimental now carry an "Experimental" badge; hover (or focus) it for a short explanation of what that means or may be hidden.
- An add-on whose files are not bundled with this deployment or is disabled is now shown in the feature list with a short unavailability note.
- The reboot warning is now part of the review summary when removing mods, so you'll see it before you commit to any changes.
- You can now see download progress for individual components. Useful if you're downloading KOReader on a slow internet connection.
- The website now respects your system's color scheme and has been given a dark mode.
- You can easily re-apply your previous patches. From now on, the web app writes the selection of patches you chose to your Kobo, so it can be read out in the future. This way, you can re-apply the same patch selection easily if a software update releases.
- It is now possible to patch in files of your choosing (e.g. fonts) when using the custom patches flow. A valid use case is permanently loading fonts onto the system partition, for example. Doing this is an advanced use case, and you should probably have `telnet` or `ssh` access to your device if you want to be able to remove these files afterwards.
- Enabling the cloud-sync patches (via custom patches) now also writes the required Kobo eReader.conf settings so the feature actually works end-to-end.
- Streamlined the patching infrastructure and updated the list of patches.
- On the hosted site, when something unexpected goes wrong, a broad error category (for example a device-write or download failure) may be recorded anonymously to help spot common problems. No details, file paths, or any personal data are ever broadcast, and expected outcomes such as choosing incompatible patches are not recorded. See "What is tracked" in the footer.
- Accessibility improvements: dialogs now trap focus, and you can navigate the icon picker with the arrow keys.

### Security and safety

- The connected-device NickelMenu path now requires Kobo software 4.23 or newer, because older versions aren't as well-supported. You should probably update your device anyway, if possible.
- Your device is now identified more reliably. Detection is now based on hardware UUIDs, with support for refurbished devices.
- Added safety checks throughout: everything is prepared before anything is written to your device, write failures are handled more gracefully, and NickelMenu removal got an extra safety pass.
