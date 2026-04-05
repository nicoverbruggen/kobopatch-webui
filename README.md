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

Required dependencies: `nodejs`,`jq`, `git`

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
      dom.js                    # Shared DOM/utility helpers ($, $q, populateSelect, renderNmCheckboxList, populateList, fetchOrThrow, triggerDownload)
      nav.js                    # Step navigation, progress bar, step history, card radio interactivity
      strings.js                # Localized UI strings
      analytics.js              # Privacy-focused analytics wrapper (Umami)
      flows/
        nickelmenu-flow.js      # NickelMenu flow: config, features, review, install, done
        patches-flow.js         # Custom patches flow: configure, build, install/download
      services/
        kobo-device.js          # KoboModels, KoboDevice class (File System Access API)
        kobo-software-urls.js   # Fetches download URLs from JSON, getSoftwareUrl, getDevicesForVersion
        patch-runner.js         # KoboPatchRunner: spawns Web Worker per build
      ui/
        patch-ui.js             # PatchUI: loads patches, parses YAML, renders toggle UI
      workers/
        patch-worker.js         # Web Worker: loads WASM, runs patchFirmware()
      wasm_exec.js              # Go WASM runtime (copied from Go SDK by build.sh, gitignored)
    nickelmenu/
      installer.js              # NickelMenu installer orchestrator: collects files, writes to device or builds ZIP
      features/
        helpers.js              # Shared postProcess helpers (appendToNmConfig, prependToNmConfig)
        custom-menu/            # Required preset menu items
        readerly-fonts/         # Font installation
        koreader/               # KOReader e-reader installation
        simplify-tabs/          # Navigation tab configuration
        hide-recommendations/   # Home screen recommendations toggle
        hide-notices/           # Home screen notices toggle
        screensaver/            # Screensaver image installation
    nickelmenu/                 # NickelMenu assets (NickelMenu.zip, gitignored)
    readerly/                   # Readerly font assets (gitignored)
    koreader/                   # KOReader assets (gitignored)
      koreader-kobo.zip
      release.json
    favicon/
  dist/                         # Build output (gitignored, fully regenerable)
    bundle.js                   # esbuild output (minified, content-hashed)
    index.html                  # Generated with cache-busted references
    css/ favicon/ patches/ nickelmenu/ readerly/ koreader/ wasm/ js/workers/
  build.mjs                     # esbuild build script + asset copy
  validate-dist.sh              # Validates all required dist resources exist
  serve.mjs                     # Static file server (used in production + local)
  package.json                  # esbuild, jszip

patches/
  index.json                    # Available patch manifest (source field maps entries to directories)
  blacklist.json                # Incompatible patches per version (generated by test-patches.sh)
  downloads.json                # Firmware download URLs by version/serial
  <version>/                    # Patch sources per firmware version
    kobopatch.yaml
    src/*.yaml

installables/
  setup.sh                      # Downloads NickelMenu, KOReader, and Readerly assets
  update-koreader.sh            # Updates KOReader in web/dist/ (for production containers)

kobopatch-wasm/
  main.go                       # Go entry point
  go.mod go.sum
  setup.sh                      # Clones kobopatch source, copies wasm_exec.js
  build.sh                      # Compiles WASM, copies to web/dist/wasm/ and web/src/js/
  test-integration.sh           # WASM integration test (via Node.js)
  test-patches.sh               # Tests all patches against cached firmware, updates blacklist.json

tests/
  cached_assets/                  # Downloaded test assets (gitignored)
  helpers/                        # Shared test utilities
    assets.js                     # Asset availability checks, firmware symlink helpers
    mock-device.js                # Mock File System Access API (simulated Kobo device)
    paths.js                      # Test asset paths, expected checksums
    tar.js                        # Tar archive parser for output verification
  build.spec.js                   # Build output verification tests
  integration.spec.js             # Playwright E2E tests
  playwright.config.js            # Parallel by default; serial when --headed or --slow
  global-setup.js                 # Creates firmware symlink once before all tests
  run-e2e.sh                      # Runs E2E tests
  screenshots.mjs                 # Captures screenshots of every wizard step
  screenshots.config.js           # Mobile + desktop project config for screenshots
  run-screenshots.sh              # Runs screenshot capture

scripts/
  test.sh                         # Runs all tests (WASM + E2E)
  serve-locally.sh                # Serves app at localhost:8888
```

## Adding a new software version

1. Add the patch sources to `patches/<version>/` and update `patches/index.json`
2. Add download URLs to `patches/downloads.json` (keyed by version then serial prefix)
3. The Kobo CDN prefix per device family (e.g. `kobo12`, `kobo13`) is stable; the date path segment changes per release

## Building the WASM binary

Requires Go 1.21+ (if Go is not installed, `setup.sh` will download it locally to `kobopatch-wasm/go/`).

```bash
make setup-wasm    # first time only — clones kobopatch source, sets up Go if needed
make build-wasm    # compiles WASM, copies to web/dist/wasm/
```

## Setting up installable assets

```bash
make setup-installables
```

This downloads NickelMenu, [KOReader](https://koreader.rocks), and [Readerly](https://github.com/nicoverbruggen/readerly) assets into `web/src/`. Each asset is skipped if already present; pass `--force` to re-download all. These are served from the app's own domain (to avoid CORS issues with GitHub release downloads). If assets are missing, the corresponding options are hidden in the UI.

To update KOReader on a running production container without a full rebuild:

```bash
installables/update-koreader.sh
```

This downloads the latest release directly into `web/dist/koreader/`, skipping the build step. It's a no-op if the current version is already up to date.

## Building the frontend

The JS source lives in `web/src/js/` as ES modules, organized by role:

- **`app.js`** — the orchestrator: creates shared state, handles device connection, mode selection, error recovery, and dialogs. Delegates to the two flow modules below.
- **`flows/`** — the two main user journeys: `nickelmenu-flow.js` (install/configure/remove NickelMenu) and `patches-flow.js` (configure/build/install custom patches).
- **`services/`** — modules that wrap external APIs with no DOM dependencies: `kobo-device.js` (File System Access API), `kobo-software-urls.js` (firmware URL lookup), `patch-runner.js` (Web Worker manager).
- **`ui/`** — UI rendering: `patch-ui.js` (patch list rendering and toggle UI).
- **`workers/`** — Web Worker files (not bundled, loaded at runtime): `patch-worker.js` (loads WASM, runs patcher).
- **`dom.js`** — shared DOM/utility helpers (`$`, `$q`, `renderNmCheckboxList`, `populateList`, `fetchOrThrow`, etc.) used across modules.
- **`nav.js`** — step navigation, progress bar, and step history (shared by both flows).

Flow modules receive a shared `state` object by reference and call back into the orchestrator via `state.showError()` and `state.goToModeSelection()` when they need to cross module boundaries. esbuild bundles everything into a single `web/dist/bundle.js`.

```bash
cd web
npm install
npm run build    # production build (minified)
make dev      # dev server with watch mode on :8889
```

## Running locally

```bash
make serve
```

This serves the app at `http://localhost:8888`. The script automatically:

1. Sets up NickelMenu, KOReader, and Readerly assets if missing
2. Builds the JS bundle (`web/dist/bundle.js`)
3. Builds the WASM binary if missing (`web/dist/wasm/kobopatch.wasm`)

You can delete the entire `web/dist/` folder and re-run `make serve` to regenerate everything.

To automatically rebuild when source files change:

```bash
make dev
```

## Testing

Run all tests (WASM integration + E2E):

```bash
make test
```

This builds the web app, compiles the WASM binary, runs the WASM integration tests, and then runs the full E2E suite. On first run it will prompt to download test assets (~190 MB total) to `tests/cached_assets/`. Tests that require missing assets are skipped.

Available flags (passed via `--`):

- `--headed` — run with a visible browser window (also sets `SLOW_MO=1000` for 1s delay between actions)
- `--test <pattern>` — filter E2E tests by name (maps to Playwright `--grep`)

Examples:

```bash
make test-headed
bash scripts/test.sh --test "NickelMenu"
bash scripts/test.sh --headed --test "back navigation"
```

Additional Playwright arguments can be appended after the flags.

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
make test-e2e
```

By default, tests run in parallel across 4 workers. When `--headed` or `--slow` is passed, tests run serially with a single worker so you can follow along in the browser.

To run with a visible browser window:

```bash
bash tests/run-e2e.sh --headed
```

To slow down each action (500ms delay) for debugging:

```bash
bash tests/run-e2e.sh --headed --slow
```

Extra Playwright arguments can be passed after `--`:

```bash
bash tests/run-e2e.sh --headed --slow -- --grep "NickelMenu"
```

### Screenshots

Capture screenshots of every wizard step for visual review (mobile + desktop):

```bash
make screenshots
```

Output is saved to `tests/screenshots/mobile/` and `tests/screenshots/desktop/` (gitignored). The script uses a separate Playwright config (`screenshots.config.js`) with two projects: mobile (393×852, 3× DPI) and desktop (1280×900, 3× DPI). Screenshots cover the full wizard flow including device connection, mode selection, NickelMenu configuration, custom patches, error states, dialogs, and the feedback widget.

### WASM integration test

Calls `patchFirmware()` directly in Go/WASM via Node.js:

```bash
make test-wasm
```

## Output validation

The WASM patcher performs several checks on each patched binary before including it in the output `KoboRoot.tgz`:

- **File size sanity check** — the patched binary must be exactly the same size as the input. kobopatch does in-place byte replacement, so any size change indicates corruption.
- **ELF header validation** — verifies the magic bytes (`\x7fELF`), 32-bit class, little-endian encoding, and ARM machine type (`0x28`) are intact after patching.
- **Archive consistency check** — after building the output tar.gz, re-reads the entire archive and verifies the sum of entry sizes matches what was written.

## Analytics (optional)

The hosted version at [kp.nicoverbruggen.be](https://kp.nicoverbruggen.be) uses optional, privacy-focused analytics via [Umami](https://umami.is) to understand how the tool is used. No personal identifiers are collected. See the "Privacy" link in the footer for details. The following events are tracked:

- **flow-start** — how the user started (manual download or device connection)
- **nm-option** — which NickelMenu option was selected (preset, NickelMenu only, or removal)
- **nm-koreader-addon** — whether KOReader was selected for installation
- **nm-simplified-home** — whether simplified home screen features were selected
- **nm-basic-tabs** — whether the basic tab bar option was selected
- **flow-end** — how the flow ended (write to device or download, for both NickelMenu and custom patches)
- **feedback** — thumbs up/down response to "Did you find it easy to use this wizard?" shown on done screens

Analytics are disabled for local and self-hosted installs. They activate only when `UMAMI_WEBSITE_ID` and `UMAMI_SCRIPT_URL` environment variables are set on the server. To test the analytics UI locally without sending any data:

```bash
make serve-fake-analytics
```

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) and [NickelMenu](https://pgaskin.net/NickelMenu/) by pgaskin. Uses [JSZip](https://stuk.github.io/jszip/) for client-side ZIP handling and [esbuild](https://esbuild.github.io/) for bundling. Software patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).

## License

[MIT](LICENSE).
