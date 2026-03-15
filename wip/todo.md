# TODO

## Done

- [x] Device detection proof of concept (File System Access API)
- [x] Serial prefix → model mapping (verified against official Kobo help page)
- [x] Architecture planning
- [x] Cloned kobopatch source (`kobopatch-src/`)

## In Progress

### WASM Build of kobopatch

- [ ] Write Go WASM wrapper (`kobopatch-src/wasm/`) exposing `PatchFirmware()` to JS
  - Accepts: config YAML (bytes), firmware zip (bytes), patch YAML files (bytes)
  - Returns: KoboRoot.tgz (bytes) or error
  - All I/O in-memory, no filesystem access
- [ ] Refactor `kobopatch/kobopatch.go` main logic into reusable function
  - Strip `os.Open`/`os.Create` → use `io.Reader`/`io.Writer`
  - Strip `os.Chdir` → resolve paths in memory
  - Strip `exec.Command` (lrelease) → skip translations
- [ ] Compile with `GOOS=js GOARCH=wasm go build`
- [ ] Test WASM binary loads and runs in browser

### Frontend - Patch UI

- [ ] `patch-ui.js` - parse patch YAML client-side, render grouped toggles
- [ ] PatchGroup mutual exclusion (radio buttons)
- [ ] Bundle patch YAML files as static assets (or fetch from known URL)
- [ ] Generate kobopatch.yaml config from UI state

### Frontend - Build Flow

- [ ] User provides firmware zip (file input or drag-and-drop)
- [ ] Load WASM module, pass firmware + config + patches
- [ ] Receive KoboRoot.tgz blob from WASM
- [ ] Write KoboRoot.tgz to device via File System Access API
- [ ] Fallback: download KoboRoot.tgz if FS Access write fails

## Future / Polish

- [ ] Browser compatibility warning with more detail
- [ ] Loading/progress states during WASM build (Web Worker?)
- [ ] Error handling for common failure modes
- [ ] Host as static site (GitHub Pages / Netlify)
- [ ] NickelMenu install/uninstall support (bonus feature)

## Architecture Change Log

- **Switched from PHP backend to fully client-side WASM.**
  Reason: avoid storing Kobo firmware files on a server (legal risk).
  The user provides their own firmware zip. kobopatch runs as WASM in the browser.
  No server needed — can be a static site.
