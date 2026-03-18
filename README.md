> [!NOTE]
> If this project has been useful to you, I ask that you **please star the repository**, that way I know that the software is being used. Also, please consider [sponsoring](https://nicoverbruggen.be/sponsor) to support my open source projects, as this is something I work on in my free time. **Thank you!** ⭐️

# KoboPatch Web UI

A web application for customising Kobo e-readers. It supports two modes:

- **NickelMenu** — installs [NickelMenu](https://pgaskin.net/NickelMenu/) [fork](https://github.com/nicoverbruggen/NickelMenu) with an optional [curated configuration](https://github.com/nicoverbruggen/kobo-config) (custom menus, fonts, screensavers, UI tweaks). Works with most Kobo devices regardless of software version. Can also remove NickelMenu from a connected device. 
  - <u>The safest patch to install</u>. These modifications tend to persist with system updates as long as NickelMenu remains functional.
  - Will automatically uninstall itself if Kobo releases an incompatible update in the future, which may happen with software v5.x at some point.

- **Custom patches** — applies community [kobopatch](https://github.com/pgaskin/kobopatch) patches to your Kobo's system software. Requires a supported software version and device model, which is currently limited to Kobo Libra Color, Kobo Clara Color and Kobo Clara BW models. 
  - A <u>more experimental solution</u> -- you need to choose what tweaks to apply.
  - These changes are wiped when system updates are released. Requires re-patching when system updates are installed.
  - Gives you a lot of customization options, but not all of them may work correctly.

## How it works

The app uses the **Filesystem Access API** (Chromium) to interface with connected Kobo devices, or falls back to manual model/software version selection with a downloadable ZIP on other browsers.

If you choose to apply custom patches, **patching happens fully client-side** — no backend needed, can be hosted as a static site. Patches are community-contributed via the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) and need to be manually updated when new Kobo software versions come out.

> [!NOTE]
> This project is not affiliated with Rakuten Kobo Inc. Patching modifies system files on your Kobo and will void your warranty. If something goes wrong, you may need to [manually reset your device](https://help.kobo.com/hc/en-us/articles/360017605314).

## User flow

1. **Connect or download** — auto-detect your Kobo via File System Access API on Chromium, or choose manual download mode (any browser)
2. **Choose mode** — NickelMenu (install/configure/remove) or custom patches
3. **Configure** — for NickelMenu: select install options (fonts, screensaver, tab/homescreen tweaks) or removal; for patches: enable/disable patches (or select none to restore original software)
4. **Review** — confirm your selections before proceeding
5. **Install** — write directly to the device (Chromium auto mode) or download a ZIP/tgz for manual installation

## File structure

```
web/public/                     # Webroot — serve this directory
  index.html                    # Single-page app, multi-step wizard
  css/
    style.css
  js/
    app.js                      # Step navigation, flow orchestration, firmware download with progress
    kobo-device.js              # KOBO_MODELS (serial prefix → name), FIRMWARE_DOWNLOADS (version+prefix → URL),
                                #   getDevicesForVersion(), getFirmwareURL(), KoboDevice class (File System Access API)
    nickelmenu.js               # NickelMenuInstaller: downloads NickelMenu.zip + kobo-config.zip, installs to
                                #   device or builds download ZIP, handles config file filtering and modification
    patch-ui.js                 # PatchUI class: loads patch zips (JSZip), parses YAML, renders toggle UI,
                                #   generates kobopatch.yaml config with overrides
    kobopatch.js                # KobopatchRunner: spawns Web Worker per build, handles progress/done/error messages
    patch-worker.js             # Web Worker: loads wasm_exec.js + kobopatch.wasm, runs patchFirmware(),
                                #   posts progress back, transfers result buffer zero-copy
    wasm_exec.js                # Go WASM support runtime (copied from Go SDK by setup.sh, gitignored)
    jszip.min.js                # Bundled JSZip library
  wasm/
    kobopatch.wasm              # Compiled WASM binary (built by build.sh, gitignored)
  patches/
    index.json                  # Contains a list of available patches
    patches_*.zip               # Each contains kobopatch.yaml + src/*.yaml patch files
  nickelmenu/                   # NickelMenu assets (built by nickelmenu/setup.sh, gitignored)
    NickelMenu.zip              # NickelMenu release
    kobo-config.zip             # Curated configuration files (fonts, screensaver, menu items)

nickelmenu/
  setup.sh                      # Downloads NickelMenu.zip and bundles kobo-config.zip from kobo-config repo

kobopatch-wasm/                 # WASM build
  main.go                       # Go entry point: jsPatchFirmware() → patchFirmware() pipeline
  go.mod
  setup.sh                      # Clones kobopatch source, copies wasm_exec.js
  build.sh                      # GOOS=js GOARCH=wasm go build, copies .wasm to web/public/wasm/
  integration_test.go           # Go integration test: validates SHA1 checksums of patched binaries
  test-integration.sh           # Downloads firmware and runs integration_test.go

tests/
  e2e/                          # Playwright E2E tests
    integration.spec.js         # Full browser tests: NickelMenu flows, custom patches, mock device
    playwright.config.js
    run-e2e.sh                  # E2E runner (downloads firmware, sets up NickelMenu assets, installs browser)
```

## Adding a new software version

1. Add the patch zip to `web/public/patches/` and update `index.json`
2. Add download URLs to `FIRMWARE_DOWNLOADS` in `js/kobo-device.js` (keyed by version then serial prefix)
3. The Kobo CDN prefix per device family (e.g. `kobo12`, `kobo13`) is stable; the date path segment changes per release

## Building the WASM binary

Requires Go 1.21+.

```bash
cd kobopatch-wasm
./setup.sh    # first time only
./build.sh    # compiles WASM, copies to web/public/wasm/
```

## Setting up NickelMenu assets

```bash
nickelmenu/setup.sh
```

This downloads `NickelMenu.zip` and clones/updates the [kobo-config](https://github.com/nicoverbruggen/kobo-config) repo to bundle `kobo-config.zip` into `web/public/nickelmenu/`.

## Running locally

```bash
./serve-locally.sh
```

This serves the app at `http://localhost:8888`. If the WASM binary or NickelMenu assets haven't been set up yet, the script handles that automatically.

## Testing

### E2E tests (Playwright)

The E2E tests cover all major user flows:

- **NickelMenu** — install with config (manual download), install NickelMenu only, remove option disabled without device
- **Custom patches** — full patching pipeline, restore original firmware
- **With simulated Kobo Libra Color** — install NickelMenu with config, remove NickelMenu, install custom patches, restore firmware

The simulated device tests mock the File System Access API with an in-memory filesystem that mimics a Kobo Libra Color (serial prefix N428, firmware 4.45.23646).

Custom patches tests download firmware 4.45.23646 (~150MB, cached in `kobopatch-wasm/testdata/`), enable a single patch, and verify SHA1 checksums of all 4 patched binaries. This specific combination is used because the author has tested it on an actual device.

```bash
cd tests/e2e
./run-e2e.sh
```

To run with a visible browser window:

```bash
./run-e2e.sh --headed
```

To slow down each action (500ms delay) for debugging:

```bash
./run-e2e.sh --headed --slow
```

Extra Playwright arguments can be passed after `--`:

```bash
./run-e2e.sh --headed --slow -- --grep "NickelMenu"
```

### WASM integration test

Calls `patchFirmware()` directly in Go/WASM via Node.js:

```bash
cd kobopatch-wasm
./test-integration.sh
```

## Output validation

The WASM patcher performs several checks on each patched binary before including it in the output `KoboRoot.tgz`:

- **File size sanity check** — the patched binary must be exactly the same size as the input. kobopatch does in-place byte replacement, so any size change indicates corruption.
- **ELF header validation** — verifies the magic bytes (`\x7fELF`), 32-bit class, little-endian encoding, and ARM machine type (`0x28`) are intact after patching.
- **Archive consistency check** — after building the output tar.gz, re-reads the entire archive and verifies the sum of entry sizes matches what was written.

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) and [NickelMenu](https://pgaskin.net/NickelMenu/) by pgaskin. Uses [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling. Software patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).

## License

[MIT](LICENSE).
