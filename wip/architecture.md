# Kobopatch Web UI - Architecture

## Overview

Fully client-side web app. No backend server needed — can be hosted as a static site.
kobopatch is compiled from Go to WebAssembly and runs entirely in the browser.

```
Browser
├── index.html + CSS + JS
├── patch-worker.js         (Web Worker for off-thread patching)
├── kobopatch.wasm          (Go compiled to WASM, loaded by worker)
├── Patch config zips        (in src/public/patches/)
├── Firmware auto-download   (fetched from ereaderfiles.kobo.com)
└── File System Access API   (read/write Kobo USB drive, Chromium only)
```

## User Flow

### Auto mode (Chromium)
1. Connect Kobo via USB
2. Click "Select Kobo Drive" → browser reads `.kobo/version`
3. App detects model + firmware version from serial prefix
4. App shows available patches with toggles, grouped by target binary
5. User configures patches (enable/disable)
6. Click "Build" → firmware downloaded from Kobo CDN → WASM patches in Web Worker
7. App writes resulting `KoboRoot.tgz` to `.kobo/` on device (or download)
8. User ejects device and reboots Kobo

### Manual mode (all browsers)
1. Select firmware version from dropdown
2. Select Kobo model from dropdown (determines firmware download URL)
3. Configure patches, click "Build"
4. Download `KoboRoot.tgz` and manually copy to `.kobo/` on device

## Components

### `kobo-device.js` — Device Access & Firmware URLs
- File System Access API for reading `.kobo/version`
- Serial prefix → model name mapping (`KOBO_MODELS`)
- Firmware download URLs per version and device prefix (`FIRMWARE_DOWNLOADS`)
- Writing `KoboRoot.tgz` back to `.kobo/`

### `patch-ui.js` — Patch Configuration
- Parses patch YAML files from zip archives (handles CRLF line endings)
- Renders patch list with toggles grouped by target file
- Enforces PatchGroup mutual exclusion (radio buttons)
- Generates kobopatch.yaml config with overrides from UI state

### `patch-worker.js` — Web Worker (in progress)
- Loads `wasm_exec.js` and `kobopatch.wasm` off the main thread
- Receives patch config + firmware via `postMessage`
- Sends progress updates back to main thread for live UI rendering
- Returns `KoboRoot.tgz` bytes via transferable buffer

### `kobopatch.wasm` — Patching Engine
- Go source in `kobopatch-wasm/`, compiled with `GOOS=js GOARCH=wasm`
- Custom WASM wrapper accepts in-memory inputs:
  - Config YAML (generated from UI state)
  - Firmware zip (auto-downloaded from Kobo CDN)
  - Patch YAML files (from bundled zip)
- Optional progress callback (4th argument) for real-time status
- Returns `{ tgz: Uint8Array, log: string }`
- No filesystem or exec calls — everything in-memory

### `kobopatch.js` — Runner Interface
- Abstracts WASM loading and invocation
- Will be updated to communicate with Web Worker

### Static Assets
- Patch config zips in `src/public/patches/` with `index.json` index
- `wasm_exec.js` (Go's WASM support JS)
- The WASM binary itself

## File Structure

```
src/
  public/                   # Webroot (static hosting)
    index.html              # Single page app
    style.css               # Styling
    app.js                  # Main controller / flow orchestration
    kobo-device.js          # File System Access API + device identification + firmware URLs
    patch-ui.js             # Patch list rendering + toggle logic
    kobopatch.js            # WASM runner interface
    patch-worker.js         # Web Worker for off-thread patching
    wasm_exec.js            # Go WASM support (from Go SDK, gitignored)
    kobopatch.wasm          # Compiled WASM binary (gitignored)
    patches/
      index.json            # Available patch versions
      patches_*.zip         # Patch config zips (kobopatch.yaml + src/*.yaml)
kobopatch-wasm/
  main.go                   # WASM entry point + patching pipeline
  go.mod                    # Go module (replaces for kobopatch + yaml fork)
  setup.sh                  # Clones kobopatch source, copies wasm_exec.js
  build.sh                  # Compiles WASM, copies artifacts to src/public/
  kobopatch-src/            # Cloned kobopatch Go source (gitignored)
wip/                        # Planning docs
.github/workflows/          # CI (GitHub Actions / Gitea compatible)
```

## Key Constraints

- **Chromium-only for auto mode**: File System Access API not in Firefox/Safari
  - Manual mode fallback: select model + firmware version from dropdowns
- **Firmware auto-download**: fetched from `ereaderfiles.kobo.com` (CORS allows `*`)
  - URLs hardcoded per device prefix in `FIRMWARE_DOWNLOADS`
  - Download URL displayed to user for verification
- **WASM binary size**: ~9.9MB uncompressed
  - Mitigated by gzip compression on static hosting (~3-4MB)
- **Memory usage**: firmware zips are ~150-300MB, patching happens in-memory
  - Should be fine on modern desktops (USB implies desktop use)

## Running

Any static file server, e.g.: `python3 -m http.server -d src/public/ 8888`
