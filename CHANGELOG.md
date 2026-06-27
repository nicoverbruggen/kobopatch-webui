# Changelog

> This changelog is for the upcoming release. When a release is tagged, the list can be emptied.

- The first screen has been updated to provide you with some more information on how to get started.
- Your device is now identified more reliably. Detection is now based on hardware UUIDs, with support for refurbished devices.
- The language of your device is now taken into account for the "Simplify Tabs" functionality. The custom menu remains in English.
- Added safety checks throughout: everything is prepared before anything is written to your device, write failures are handled more gracefully, and NickelMenu removal got an extra safety pass.
- The reboot warning is now part of the review summary when removing mods, so you'll see it before you commit to any changes.
- You can now see download progress for individual components. Useful if you're downloading KOReader on a slow internet connection.
- The website now respects your system's color scheme and has been given a dark mode.
- You can easily re-apply your previous patches. From now on, the web app writes the selection of patches you chose to your Kobo, so it can be read out in the future. This way, you can re-apply the same patch selection easily if a software update releases.
- It is now possible to patch in files of your choosing (e.g. fonts) when using the custom patches flow. A valid use case is permanently loading fonts onto the system partition, for example. Doing this is an advanced use case, and you should probably have `telnet` or `ssh` access to your device if you want to be able to remove these files afterwards.
- Enabling the cloud-sync patches (via custom patches) now also writes the required Kobo eReader.conf settings so the feature actually works end-to-end.
- Fixed installs that could fail with "writing to your device didn't work" on newer browsers: a configuration file some browsers refuse to write directly (such as NickelClock's settings) is now delivered through the installation package and applied on reboot, so installing directly to your device works again.
- Streamlined the patching infrastructure and updated the list of patches.
- Accessibility improvements: dialogs now trap focus, and you can navigate the icon picker with the arrow keys.
