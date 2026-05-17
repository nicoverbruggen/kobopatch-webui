> [!NOTE]
> If this project has been useful to you, I ask that you **please star the repository**, that way I know that the software is being used. Also, please consider [sponsoring](https://nicoverbruggen.be/sponsor) to support my open source projects, as this is something I work on in my free time. **Thank you!** ⭐️

# KoboPatch Web UI

A web application for customising Kobo e-readers. It supports two modes:

- **NickelMenu** — installs [NickelMenu](https://pgaskin.net/NickelMenu/) [fork](https://github.com/nicoverbruggen/NickelMenu) with an optional [curated configuration](https://github.com/nicoverbruggen/kobo-config) (custom menus, fonts, screensavers, UI tweaks). Works with most Kobo devices regardless of software version. Can also remove NickelMenu from a connected device.
  - <u>The safest patch to install</u>. These modifications tend to persist with system updates as long as NickelMenu remains functional.
  - You can optionally install KOReader using this method, too.
  - Will automatically uninstall itself if Kobo releases an incompatible update in the future, which may happen with software v5.x at some point.

- **Custom patches** — applies community [kobopatch](https://github.com/pgaskin/kobopatch) patches to your Kobo's system software. Requires a supported software version and device model, which is currently limited to more recent devices.
  - A <u>more experimental solution</u> -- you need to choose what tweaks to apply.
  - These changes are wiped when system updates are released. Requires re-patching when system updates are installed.
  - Gives you a lot of customization options, but not all of them may work correctly, and not all devices are supported.

## Prerequisites

Required dependencies: `nodejs`, `jq`, `git`

**Note**: Go is required for the WASM build, but downloaded automatically if not installed.

## How it works

The app uses the **Filesystem Access API** (Chromium) to interface with connected Kobo devices, or falls back to manual model/software version selection with a downloadable ZIP on other browsers.

If you choose to apply custom patches, **patching happens fully client-side** — no backend needed, can be hosted as a static site. Patches are community-contributed via the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) and need to be manually updated when new Kobo software versions come out.

> [!NOTE]
> This project is not affiliated with Rakuten Kobo Inc. Patching modifies system files on your Kobo and will void your warranty. If something goes wrong, you may need to [manually reset your device](https://help.kobo.com/hc/en-us/articles/360017605314).

## Device support

If you want to install **NickelMenu**:

- Any Kobo released in 2025 or earlier, running software version >=4.6 and <5.0.

If you want to apply **custom patches**:

- Software **4.45.x**: Kobo Libra Colour, Kobo Clara Colour, Kobo Clara BW
- Software **4.38.x**: Kobo Clara 2E, Kobo Libra 2, Kobo Elipsa 2E, Kobo Sage, Kobo Elipsa

> [!WARNING]
> **Software 5.x is currently not supported.** On the latest devices, it is possible to install an accessibility preview, which upgrades the software to version 5.0.

## User flow

1. **Connect or download** — auto-detect your Kobo via File System Access API on Chromium, or choose manual download mode (any browser)
2. **Choose mode** — NickelMenu (install/configure/remove) or custom patches
3. **Configure** — for NickelMenu: select install options (fonts, screensaver, tab/homescreen tweaks, KOReader) or removal; for patches: enable/disable patches (or select none to restore original software)
4. **Backup** — create or manually confirm a backup before changing NickelMenu files
5. **Review** — confirm your selections before proceeding
6. **Install or remove** — write directly to the device (Chromium auto mode) or download a ZIP/tgz for manual installation

## Technical information

Architecture, file structure, build internals, and detailed testing notes live in [PROJECT.md](PROJECT.md).

## Analytics

The hosted version at [kp.nicoverbruggen.be](https://kp.nicoverbruggen.be) uses optional, privacy-focused analytics via [Umami](https://umami.is) to understand how the tool is used. No personal identifiers are collected. See the "Privacy" link in the footer for details. The following events are tracked:

- **flow-start** — how the user started (manual download or device connection)
- **nm-option** — which NickelMenu option was selected (preset, NickelMenu only, or removal)
- **nm-koreader-addon** — whether KOReader was selected for installation
- **nm-simplified-home** — whether simplified home screen features were selected
- **nm-basic-tabs** — whether the basic tab bar option was selected
- **flow-end** — how the flow ended (write, download, or removal outcome for NickelMenu, custom patches, and restore)
- **feedback** — thumbs up/down response to "Did you find it easy to use this wizard?" shown on done screens

Analytics are disabled for local and self-hosted installs. They activate only when `UMAMI_WEBSITE_ID` and `UMAMI_SCRIPT_URL` environment variables are set on the server. To test the analytics UI locally without sending any data:

```bash
make serve-fake-analytics
```

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) and [NickelMenu](https://pgaskin.net/NickelMenu/) by pgaskin. Uses [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling and [esbuild](https://esbuild.github.io/) for bundling. Software patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).

## License

[MIT](LICENSE).
