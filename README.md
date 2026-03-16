# KoboPatch Web UI

> [!IMPORTANT]
> **This is an experiment**, mostly created with the help of Claude and some very precise instructions. It currently only supports the latest version of Kobo's software, and only for the Kobo Libra Color, Kobo Clara Color and Kobo Clara BW models. Further support may be added at a later date.

A web application that provides a GUI for applying custom [kobopatch](https://github.com/pgaskin/kobopatch) patches to Kobo e-readers. It uses the File System Access API (Chromium) to interface with connected Kobo devices, or falls back to manual model/software version selection on other browsers.

The app makes it easy to configure which patches to apply, downloads the correct software update from Kobo's servers, runs the patcher (compiled to WebAssembly), and places the resulting `KoboRoot.tgz` on the device. The user then safely ejects and reboots to apply. It can also restore the original unpatched software.

Fully client-side — no backend needed, can be hosted as a static site. Patches are community-contributed via the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247) and need to be manually updated when new Kobo software versions come out.

> [!NOTE]
> This project is not affiliated with Rakuten Kobo Inc. Patching modifies system files on your Kobo and will void your warranty. If something goes wrong, you may need to [manually reset your device](https://help.kobo.com/hc/en-us/articles/360017605314).

## User flow

1. Select device (auto-detect via File System Access API on Chromium, or manual dropdowns on any browser)
2. Configure patches (enable/disable, PatchGroup mutual exclusion via radio buttons) — or select none to restore original software
3. Build — software update auto-downloaded from Kobo's CDN (`ereaderfiles.kobo.com`, CORS open), patched via WASM in a Web Worker
4. Write `KoboRoot.tgz` to device (Chromium auto mode) or download manually

## File structure

```
web/public/                     # Webroot — serve this directory
  index.html                    # Single-page app, 3-step wizard (Device → Patches → Build)
  style.css
  app.js                        # Step navigation, flow orchestration, firmware download with progress
  kobo-device.js                # KOBO_MODELS (serial prefix → name), FIRMWARE_DOWNLOADS (version+prefix → URL),
                                #   getDevicesForVersion(), getFirmwareURL(), KoboDevice class (File System Access API)
  patch-ui.js                   # PatchUI class: loads patch zips (JSZip), parses YAML, renders toggle UI,
                                #   generates kobopatch.yaml config with overrides
  kobopatch.js                  # KobopatchRunner: spawns Web Worker per build, handles progress/done/error messages
  patch-worker.js               # Web Worker: loads wasm_exec.js + kobopatch.wasm, runs patchFirmware(),
                                #   posts progress back, transfers result buffer zero-copy
  wasm_exec.js                  # Go WASM support runtime (copied from Go SDK by setup.sh, gitignored)
  kobopatch.wasm                # Compiled WASM binary (built by build.sh, gitignored)
  patches/
    index.json                  # [{ "version": "4.45.23646", "filename": "patches_4.45.23646.zip" }]
    patches_*.zip               # Each contains kobopatch.yaml + src/*.yaml patch files

kobopatch-wasm/                 # WASM build
  main.go                       # Go entry point: jsPatchFirmware() → patchFirmware() pipeline
                                #   Accepts configYAML, firmwareZip, patchFiles, optional progressFn
                                #   Returns { tgz: Uint8Array, log: string }
  go.mod
  setup.sh                      # Clones kobopatch source, copies wasm_exec.js
  build.sh                      # GOOS=js GOARCH=wasm go build, copies .wasm to web/public/,
                                #   sets ?ts= cache-bust timestamp in patch-worker.js
```

## Adding a new software version

1. Add the patch zip to `web/public/patches/` and update `index.json`
2. Add download URLs to `FIRMWARE_DOWNLOADS` in `kobo-device.js` (keyed by version then serial prefix)
3. The Kobo CDN prefix per device family (e.g. `kobo12`, `kobo13`) is stable; the date path segment changes per release

## Building the WASM binary

Requires Go 1.21+.

```bash
cd kobopatch-wasm
./setup.sh    # first time only
./build.sh    # compiles WASM, copies to web/public/
```

## Running locally

```bash
python3 -m http.server -d web/public/ 8888
```

## Testing

To further validate the patched `KoboRoot.tgz` packages are identical to what a local version of `kobopatch` would generate, two integration tests have been added.

Both integration tests run the full patching pipeline with software version 4.45.23646 (Kobo Libra Color), enable a single patch, and verify SHA1 checksums of all 4 patched binaries. The software update zip (~150MB) is downloaded once and cached in `kobopatch-wasm/testdata/`.

The reason this particular combination is used is simple: the author has actually used that specific version on an actual device before and it's a known, working, patched version of the software. So comparing hashes against it seems like a good idea.

**WASM integration test** — calls `patchFirmware()` directly in Go/WASM via Node.js:

```bash
cd kobopatch-wasm
./test-integration.sh
```

**Playwright E2E test** — drives the full browser UI (manual mode, headless):

```bash
cd e2e
./run-e2e.sh
```

To run the Playwright test with a visible browser window:

```bash
cd e2e
./run-e2e-local.sh
```

## Output validation

The WASM patcher performs several checks on each patched binary before including it in the output `KoboRoot.tgz`:

- **File size sanity check** — the patched binary must be exactly the same size as the input. kobopatch does in-place byte replacement, so any size change indicates corruption.
- **ELF header validation** — verifies the magic bytes (`\x7fELF`), 32-bit class, little-endian encoding, and ARM machine type (`0x28`) are intact after patching.
- **Archive consistency check** — after building the output tar.gz, re-reads the entire archive and verifies the sum of entry sizes matches what was written.

## Credits

Built on [kobopatch](https://github.com/pgaskin/kobopatch) by pgaskin. Patches and discussion on the [MobileRead forums](https://www.mobileread.com/forums/forumdisplay.php?f=247).
