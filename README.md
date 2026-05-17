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

This includes custom home screen changes, a preconfigured NickelMenu, some extra fonts, screensavers and even KOReader if you'd like.  (You can select which specific tweaks to apply.)

Works with most Kobo devices regardless of software version. If you don't like it and change your mind, you can also remove the modification using the same method.

- <u>This is easily the safest mod to install</u>. These modifications tend to persist with system updates as long as NickelMenu remains functional.
- You can optionally install **KOReader** using this method, too.
- Recommended for everyone. Easy to uninstall, too.

## Mode B: Custom Patches

**This mode applies community [kobopatch](https://github.com/pgaskin/kobopatch) patches to your Kobo's system software.**

You can combine with with option A, if you'd like, but this is a more involved process. This requires a supported software version and device model, which is currently limited to more recent devices.

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

1. **Connect or download** — auto-detect your Kobo via File System Access API on Chromium, or choose manual download mode (any browser)
2. **Choose mode** — NickelMenu (install/configure/remove) or custom patches
3. **Configure** — for NickelMenu: select install options (fonts, screensaver, tab/homescreen tweaks, KOReader) or removal; for patches: enable/disable patches (or select none to restore original software)
4. **Backup** — create or manually confirm a backup before changing NickelMenu files
5. **Review** — confirm your selections before proceeding
6. **Install or remove** — write directly to the device (Chromium auto mode) or download a ZIP/tgz for manual installation

## Technical information

**Note:** This project was built with some assistance of agentic coding tools, some local and some hosted.

More relevant notes on architecture, file structure, build internals, and detailed testing notes live in [PROJECT.md](PROJECT.md).

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) and [NickelMenu](https://pgaskin.net/NickelMenu/) by pgaskin. Uses [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling and [esbuild](https://esbuild.github.io/) for bundling. Software patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).

## License

[MIT](LICENSE).
