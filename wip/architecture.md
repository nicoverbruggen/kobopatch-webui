# Kobopatch Web UI - Architecture

## Overview

Fully client-side web app. No backend server needed — can be hosted as a static site.
kobopatch is compiled from Go to WebAssembly and runs entirely in the browser.

```
Browser
├── index.html + CSS + JS
├── kobopatch.wasm          (Go compiled to WASM)
├── Patch YAML files         (bundled as static assets)
└── File System Access API   (read/write Kobo USB drive)
```

## User Flow

1. Connect Kobo via USB
2. Click "Select Kobo Drive" → browser reads `.kobo/version`
3. App detects model + firmware version from serial prefix
4. User provides firmware zip file (file picker / drag-and-drop)
5. App shows available patches with toggles, grouped by target binary
6. User configures patches (enable/disable)
7. Click "Build" → WASM runs kobopatch in-browser
8. App writes resulting `KoboRoot.tgz` to `.kobo/` on device
9. User ejects device and reboots Kobo

## Components

### `kobo-device.js` — Device Access
- File System Access API for reading `.kobo/version`
- Serial prefix → model name mapping
- Writing `KoboRoot.tgz` back to `.kobo/`

### `patch-ui.js` — Patch Configuration
- Parses patch YAML files (bundled or fetched)
- Renders patch list with toggles grouped by target file
- Enforces PatchGroup mutual exclusion
- Generates overrides config

### `kobopatch.wasm` — Patching Engine
- Go source in `kobopatch-src/`, compiled with `GOOS=js GOARCH=wasm`
- Custom WASM wrapper accepts in-memory inputs:
  - Config YAML (generated from UI state)
  - Firmware zip (from user file picker)
  - Patch YAML files (bundled)
- Returns `KoboRoot.tgz` bytes
- No filesystem or exec calls — everything in-memory

### Static Assets
- Patch YAML files from `kobopatch/src/*.yaml`
- `wasm_exec.js` (Go's WASM support JS)
- The WASM binary itself

## File Structure

```
src/
  frontend/
    index.html          # Single page app
    style.css           # Styling
    app.js              # Main controller / flow orchestration
    kobo-device.js      # File System Access API + device identification
    patch-ui.js         # Patch list rendering + toggle logic (TODO)
    wasm_exec.js        # Go WASM support (from Go SDK)
    kobopatch.wasm      # Compiled WASM binary
    patches/            # Bundled patch YAML files
kobopatch-src/          # Cloned kobopatch Go source
  wasm/                 # WASM wrapper (to be created)
```

## Key Constraints

- **Chromium-only**: File System Access API not available in Firefox/Safari
  - Fallback: offer KoboRoot.tgz as download with manual copy instructions
- **User provides firmware**: we don't host firmware files (legal reasons)
- **WASM binary size**: Go WASM builds are typically 5-15MB
  - Mitigated by gzip compression on static hosting (~2-5MB)
- **Memory usage**: firmware zips are ~150MB, patching happens in-memory
  - Should be fine on modern desktops (USB implies desktop use)

## Running

Any static file server, e.g.: `python3 -m http.server -d src/frontend/ 8080`
