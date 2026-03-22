> [!NOTE]
> If this project has been useful to you, I ask that you **please star the repository**, that way I know that the software is being used. Also, please consider [sponsoring](https://nicoverbruggen.be/sponsor) to support my open source projects, as this is something I work on in my free time. **Thank you!** ⭐️

# KoboPatch Web UI

A web application for customising Kobo e-readers. It supports two modes:

- **NickelMenu** — installs [NickelMenu](https://pgaskin.net/NickelMenu/) [fork](https://github.com/nicoverbruggen/NickelMenu) with an optional [curated configuration](https://github.com/nicoverbruggen/kobo-config) (custom menus, fonts, screensavers, UI tweaks). Works with most Kobo devices regardless of software version. Can also remove NickelMenu from a connected device.
  - <u>The safest patch to install</u>. These modifications tend to persist with system updates as long as NickelMenu remains functional.
  - You can optionally install KOReader using this method, too.
  - Will automatically uninstall itself if Kobo releases an incompatible update in the future, which may happen with software v5.x at some point.

- **Custom patches** — applies community [kobopatch](https://github.com/pgaskin/kobopatch) patches to your Kobo's system software. Requires a supported software version and device model, which is currently limited to Kobo Libra Color, Kobo Clara Color and Kobo Clara BW models. 
  - A <u>more experimental solution</u> -- you need to choose what tweaks to apply.
  - These changes are wiped when system updates are released. Requires re-patching when system updates are installed.
  - Gives you a lot of customization options, but not all of them may work correctly.

## Prerequisites

- [Node.js](https://nodejs.org/) (includes npm)
- [jq](https://jqlang.github.io/jq/) — `brew install jq` / `apt install jq`
- [Git](https://git-scm.com/)

Go is required for the WASM build but downloaded automatically if not installed.

## How it works

The app uses the **Filesystem Access API** (Chromium) to interface with connected Kobo devices, or falls back to manual model/software version selection with a downloadable ZIP on other browsers.

If you choose to apply custom patches, **patching happens fully client-side** — no backend needed, can be hosted as a static site. Patches are community-contributed via the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) and need to be manually updated when new Kobo software versions come out.

> [!NOTE]
> This project is not affiliated with Rakuten Kobo Inc. Patching modifies system files on your Kobo and will void your warranty. If something goes wrong, you may need to [manually reset your device](https://help.kobo.com/hc/en-us/articles/360017605314).

## User flow

1. **Connect or download** — auto-detect your Kobo via File System Access API on Chromium, or choose manual download mode (any browser)
2. **Choose mode** — NickelMenu (install/configure/remove) or custom patches
3. **Configure** — for NickelMenu: select install options (fonts, screensaver, tab/homescreen tweaks, KOReader) or removal; for patches: enable/disable patches (or select none to restore original software)
4. **Review** — confirm your selections before proceeding
5. **Install** — write directly to the device (Chromium auto mode) or download a ZIP/tgz for manual installation

## File structure

```
web/
  src/                          # Source assets (committed)
    index.html                  # Single-page app template
    css/
      style.css
    js/
      app.js                    # Orchestrator: shared state, device connection, mode selection, error/retry, dialogs
      dom.js                    # Shared DOM helpers ($, $q, $qa, formatMB, populateSelect, triggerDownload)
      nav.js                    # Step navigation, progress bar, step history, card radio interactivity
      nickelmenu-flow.js        # NickelMenu flow: config, features, review, install, done
      patches-flow.js           # Custom patches flow: configure, build, install/download
      kobo-device.js            # KoboModels, KoboDevice class
      kobo-software-urls.js     # Fetches download URLs from JSON, getSoftwareUrl, getDevicesForVersion
      nickelmenu/               # NickelMenu feature modules + installer orchestrator
      patch-ui.js               # PatchUI: loads patches, parses YAML, renders toggle UI
      patch-runner.js           # KoboPatchRunner: spawns Web Worker per build
      patch-worker.js           # Web Worker: loads WASM, runs patchFirmware()
      strings.js                # Localized UI strings
      wasm_exec.js              # Go WASM runtime (copied from Go SDK by build.sh, gitignored)
    patches/
      index.json                # Available patch manifest
      downloads.json            # Firmware download URLs by version/serial (may be auto-generated)
      patches_*.zip             # Patch files per firmware version
    nickelmenu/                 # NickelMenu assets (NickelMenu.zip generated by nickelmenu/setup.sh, gitignored)
    readerly/                   # Readerly font assets (generated by readerly/setup.sh, gitignored)
    koreader/                   # KOReader assets (generated by koreader/setup.sh, gitignored)
      koreader-kobo.zip
      release.json
    favicon/
  dist/                         # Build output (gitignored, fully regenerable)
    bundle.js                   # esbuild output (minified, content-hashed)
    index.html                  # Generated with cache-busted references
    css/ favicon/ patches/ nickelmenu/ readerly/ koreader/ wasm/ js/wasm_exec.js
  build.mjs                     # esbuild build script + asset copy
  package.json                  # esbuild, jszip

nickelmenu/
  setup.sh                      # Downloads NickelMenu.zip

readerly/
  setup.sh                      # Downloads latest Readerly fonts from GitHub releases

koreader/
  setup.sh                      # Downloads latest KOReader release for Kobo
  update.sh                     # Updates KOReader in web/dist/ (for production containers)

kobopatch-wasm/
  main.go                       # Go entry point
  go.mod go.sum
  setup.sh                      # Clones kobopatch source, copies wasm_exec.js
  build.sh                      # Compiles WASM, copies to web/dist/wasm/ and web/src/js/
  integration_test.go
  test-integration.sh

tests/
  cached_assets/                  # Downloaded test assets (gitignored)
  e2e/
    helpers/                      # Shared test utilities
      assets.js                   # Asset availability checks, firmware symlink helpers
      mock-device.js              # Mock File System Access API (simulated Kobo device)
      paths.js                    # Test asset paths, expected checksums
      tar.js                      # Tar archive parser for output verification
    integration.spec.js           # Playwright E2E tests
    playwright.config.js
    run-e2e.sh

# Root scripts
test.sh                         # Runs all tests (WASM + E2E)
serve-locally.sh                # Serves app at localhost:8888
```

## Adding a new software version

1. Add the patch zip to `web/src/patches/` and update `index.json`
2. Add download URLs to `web/src/patches/downloads.json` (keyed by version then serial prefix)
3. The Kobo CDN prefix per device family (e.g. `kobo12`, `kobo13`) is stable; the date path segment changes per release

## Building the WASM binary

Requires Go 1.21+ (if Go is not installed, `setup.sh` will download it locally to `kobopatch-wasm/go/`).

```bash
cd kobopatch-wasm
./setup.sh    # first time only — clones kobopatch source, sets up Go if needed
./build.sh    # compiles WASM, copies to web/dist/wasm/
```

## Setting up NickelMenu assets

```bash
nickelmenu/setup.sh
```

This downloads `NickelMenu.zip` into `web/src/nickelmenu/`.

## Setting up Readerly font assets

```bash
readerly/setup.sh
```

This downloads the latest [Readerly](https://github.com/nicoverbruggen/readerly) font release (`KF_Readerly.zip`) into `web/src/readerly/`. The fonts are served from the app's own domain and downloaded by the browser at install time.

## Setting up KOReader assets

```bash
koreader/setup.sh
```

This downloads the latest [KOReader](https://koreader.rocks) release for Kobo into `web/src/koreader/`. The KOReader zip is served from the app's own domain (to avoid CORS issues with GitHub release downloads). The version is displayed in the UI next to the KOReader checkbox. If the assets are missing, the KOReader option is hidden.

To update KOReader on a running production container without a full rebuild:

```bash
koreader/update.sh
```

This downloads the latest release directly into `web/dist/koreader/`, skipping the build step. It's a no-op if the current version is already up to date.

## Building the frontend

The JS source lives in `web/src/js/` as ES modules, organized around the two main user flows:

- **`app.js`** — the orchestrator: creates shared state, handles device connection, mode selection, error recovery, and dialogs. Delegates to the two flow modules below.
- **`nickelmenu-flow.js`** — the entire NickelMenu path (config, features, review, install, done).
- **`patches-flow.js`** — the entire custom patches path (configure, build, install/download).
- **`nav.js`** — step navigation, progress bar, and step history (shared by both flows).
- **`dom.js`** — tiny DOM utility helpers (`$`, `$q`, `$qa`, etc.) used everywhere.

Flow modules receive a shared `state` object by reference and call back into the orchestrator via `state.showError()` and `state.goToModeSelection()` when they need to cross module boundaries. esbuild bundles everything into a single `web/dist/bundle.js`.

```bash
cd web
npm install
npm run build    # production build (minified)
npm run dev      # dev server with watch mode on :8889
```

## Running locally

```bash
./serve-locally.sh
```

This serves the app at `http://localhost:8888`. The script automatically:

1. Sets up NickelMenu, KOReader, and Readerly assets if missing
2. Builds the JS bundle (`web/dist/bundle.js`)
3. Builds the WASM binary if missing (`web/dist/wasm/kobopatch.wasm`)

You can delete the entire `web/dist/` folder and re-run `serve-locally.sh` to regenerate everything.

To automatically rebuild when source files change:

```bash
./serve-locally.sh --dev
```

## Testing

Run all tests (WASM integration + E2E):

```bash
./test.sh
```

This builds the web app, compiles the WASM binary, runs the WASM integration tests, and then runs the full E2E suite. On first run it will prompt to download test assets (~190 MB total) to `tests/cached_assets/`. Tests that require missing assets are skipped.

### E2E tests (Playwright)

The E2E tests cover all major user flows:

- **NickelMenu** — install with config (manual download), install NickelMenu only, KOReader installation, remove option disabled without device
- **Custom patches** — full patching pipeline, restore original firmware, build failure with "Go Back" recovery
- **Device detection** — firmware version validation (4.x supported, 5.x incompatible), unknown model warning
- **Back navigation** — verifies every back button returns to the correct previous screen in both auto and manual mode
- **With simulated Kobo Libra Color** — install NickelMenu with config, remove NickelMenu, install custom patches, restore firmware

The simulated device tests mock the File System Access API with an in-memory filesystem that mimics a Kobo Libra Color (serial prefix N428, firmware 4.45.23646).

Custom patches tests use firmware 4.45.23646 (~150 MB, cached in `tests/cached_assets/`), enable a single patch, and verify SHA1 checksums of all 4 patched binaries. This specific combination is used because the author has tested it on an actual device. KOReader tests use a real KOReader zip (~39 MB, also cached) to verify the full installation flow.

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

## Analytics (optional)

The hosted version at [kp.nicoverbruggen.be](https://kp.nicoverbruggen.be) uses optional, privacy-focused analytics via [Umami](https://umami.is) to understand how the tool is used. No personal identifiers are collected. See the "Privacy" link in the footer for details.

Analytics are disabled for local and self-hosted installs. They activate only when `UMAMI_WEBSITE_ID` and `UMAMI_SCRIPT_URL` environment variables are set on the server. To test the analytics UI locally without sending any data:

```bash
./serve-locally.sh --fake-analytics
```

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) and [NickelMenu](https://pgaskin.net/NickelMenu/) by pgaskin. Uses [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling and [esbuild](https://esbuild.github.io/) for bundling. Software patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).

## License

[MIT](LICENSE).
