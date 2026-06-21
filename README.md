> [!NOTE]
> If this project has been useful to you, I ask that you **please star the repository**, that way I know that the software is being used. Also, please consider [sponsoring](https://nicoverbruggen.be/sponsor) to support my open source projects, as this is something I work on in my free time. **Thank you!** ⭐️

# KoboPatch Web UI

A web application for customising Kobo e-readers available [here](https://kp.nicoverbruggen.be).

## About this project

What's this about? Well, I have two resources that explain why the project was built:

- **YouTube:** I have recorded a [YouTube video](https://youtu.be/lNtg_GfCups) that includes an explanation and demonstration. Also includes a demo of my [custom fonts](https://github.com/nicoverbruggen/ebook-fonts).

- **Blog:** I have also written a lengthy [blog post](https://nicoverbruggen.be/blog/kobopatch-webui) on the subject. This blog post contains more technical details than the video.

The project itself currently has a few operational modes, depending on what it is that you're trying to do. They're documented below.

## Mode A: NickelMenu

**This mode installs [NickelMenu](https://pgaskin.net/NickelMenu/) [fork](https://github.com/nicoverbruggen/NickelMenu) with an optional [curated configuration](https://github.com/nicoverbruggen/kobo-config).** 

This includes custom home screen changes, a preconfigured NickelMenu, some extra fonts, screensavers, NickelClock (which displays the clock while you're reading), and alternative reading apps like KOReader or Cadmus if you'd like. (You can pick and choose which specific tweaks to apply.)

Works with most Kobo devices regardless of software version. If you don't like it and change your mind, you can also remove the modification using the same method.

- <u>This is easily the safest mod to install</u>. These modifications tend to persist with system updates as long as NickelMenu remains functional.
- You can optionally install **KOReader**, **Cadmus**, or **NickelClock** using this method, too.
- Recommended for everyone. Easy to uninstall, too.

## Mode B: Custom Patches

**This mode applies community [kobopatch](https://github.com/pgaskin/kobopatch) patches to your Kobo's system software.**

You can combine this with option A, if you'd like, but this is a more involved process. This requires a supported software version and device model, which is currently limited to more recent devices.

- This is a <u>more experimental mod</u>: you need to choose what tweaks to apply.
- Changes made by these patches are usually reset when system updates are released. That means you must re-patch whenever your device is updated.
- Gives you a lot of customization options, but not all of them may work correctly, and not all devices are supported.
- Recommended for advanced users and those interested in more technical tweaks. For tinkerers.

## Hosted version

**Want to patch your device?** You don't need to set this project up yourself. I'm hosting the project here: [kp.nicoverbruggen.be](https://kp.nicoverbruggen.be).

Please read the instructions carefully. I've done my best to make this as user-friendly and safe as possible, but there's always a small risk when applying custom mods to your devices.

Here's the obligatory legal disclaimer:

> [!NOTE]
> This project is not affiliated with Rakuten Kobo Inc. Patching modifies system files on your Kobo and will void your warranty. If something goes wrong, you may need to [manually reset your device](https://help.kobo.com/hc/en-us/articles/360017605314).

## How it works

The app uses the **Filesystem Access API** (Chromium) to interface with connected Kobo devices, or falls back to manual model/software version selection with a downloadable ZIP on other browsers.

If you choose to apply custom patches, **patching happens fully client-side** — no backend needed, can be hosted as a static site. Patches are community-contributed via the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) and need to be manually updated when new Kobo software versions come out.

## Device support

If you want to install **NickelMenu**:

- Any Kobo released in 2025 or earlier, running software version >=4.6 and <5.0.

If you want to apply **custom patches**:

- Software **4.45.x**: Kobo Libra Colour, Kobo Clara Colour, Kobo Clara BW
- Software **4.38.x**: Kobo Clara 2E, Kobo Libra 2, Kobo Elipsa 2E, Kobo Sage, Kobo Elipsa

> [!WARNING]
> **Software 5.x is currently not supported.** On the latest devices, it is possible to install an accessibility preview, which upgrades the software to version 5.0.

## User flow

1. **Connect or download**: auto-detect your Kobo via File System Access API on Chromium, or choose manual download mode (any browser)
2. **Choose mode**: NickelMenu (install/configure/remove) or custom patches
3. **Configure**: for NickelMenu: select what mods to install (fonts, screensaver, tab/homescreen tweaks, reading apps) or remove; for patches: enable/disable patches (or select none to restore original software)
4. **Backup**: create or manually confirm a backup before changing NickelMenu files
5. **Review**: confirm your selections before proceeding
6. **Install or remove**: write directly to the device (Chromium auto mode) or download a ZIP/tgz for manual installation

## Technical information

**Note:** This project was built with some assistance of agentic coding tools, some local and some hosted. The resulting project has been thoroughly tested by the author on various Kobo devices, including: Kobo Libra 2, Kobo Clara BW, Kobo Libra Color, Kobo Elipsa. A comprehensive test suite (unit tests and end-to-end tests) is also included to verify everything works as expected and no regressions occur.

More relevant notes on architecture, file structure, build internals, and detailed testing notes live in [PROJECT.md](PROJECT.md). Instructions for agentic coding tools live in [AGENTS.md](AGENTS.md), and should be read before work on features starts.

## Credits

This project stands on the work of many others. Each remains the property of its respective authors and is used under its own license — my sincere thanks to everyone who maintains them.

Some dependencies (see `installables.lock`) are bundled as part of the webapp, as otherwise there'd be issues with CORS and downloading assets from GitHub releases.

**Patching & menu**

- [kobopatch](https://github.com/pgaskin/kobopatch) — the patching engine, compiled to WebAssembly to patch firmware in the browser. _(MIT)_
- [NickelMenu](https://pgaskin.net/NickelMenu/) — the custom menu framework, installed from a [fork](https://github.com/nicoverbruggen/NickelMenu) with a [curated configuration](https://github.com/nicoverbruggen/kobo-config). _(MIT)_

**Optional add-ons**

- [NickelClock](https://github.com/shermp/NickelClock) — a clock on the reading screen. _(MIT)_
- [KOReader](https://github.com/koreader/koreader) — a feature-rich document and e-book reader. _(AGPL-3.0)_
- [Cadmus](https://github.com/OGKevin/cadmus) — a reading companion app for Kobo, based on [Plato](https://github.com/baskerville/plato). _(AGPL-3.0)_
- The optional curated fonts — [Readerly](https://github.com/nicoverbruggen/readerly) _(OFL-1.1)_, [Libron](https://github.com/nicoverbruggen/libron) _(OFL-1.1)_, and [Cartisse](https://github.com/nicoverbruggen/cartisse) _(Bitstream Charter license)_ — part of the [ebook-fonts](https://github.com/nicoverbruggen/ebook-fonts) collection ([website](https://ebook-fonts.nicoverbruggen.be)), repackaged for Kobo.

**Libraries & tooling**

- [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling _(MIT or GPL-3.0)_ and [js-yaml](https://github.com/nodeca/js-yaml) for parsing patch files _(MIT)_.
- [Vite](https://vite.dev/) for bundling and local development _(MIT)_ and [Go](https://go.dev/) for compiling kobopatch to WebAssembly _(BSD-3-Clause)_.
- [ESLint](https://eslint.org/) _(MIT)_ and [Playwright](https://playwright.dev/) _(Apache-2.0)_ for linting and end-to-end testing.

Software patches and discussion come from the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) community.

## License

[MIT](LICENSE).
