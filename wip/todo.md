# TODO

## Done

- [x] Device detection proof of concept (File System Access API)
- [x] Serial prefix → model mapping (verified against official Kobo help page)
- [x] Architecture planning (updated: fully client-side, no PHP backend)
- [x] Installed Go via Homebrew (v1.26.1)
- [x] Verified all kobopatch tests pass natively
- [x] Verified all kobopatch tests pass under `GOOS=js GOARCH=wasm` (via Node.js)
- [x] Updated device identification doc with correct model list
- [x] Removed obsolete backend-api.md
- [x] Created `kobopatch-wasm/` with setup.sh, build.sh, go.mod, main.go
- [x] WASM wrapper compiles successfully (9.9MB)
- [x] All kobopatch tests still pass with our module's replace directives
- [x] Cleaned up .gitignore

## In Progress

### Integration Testing

- [ ] Test WASM binary in actual browser (load wasm_exec.js + kobopatch.wasm)
- [ ] Test `patchFirmware()` JS function end-to-end with real firmware zip + patches

### Frontend - Patch UI

- [ ] YAML parsing in JS (extract patch names, descriptions, enabled, PatchGroup)
- [ ] `patch-ui.js` — render grouped toggles per target file
- [ ] PatchGroup mutual exclusion (radio buttons)
- [ ] Generate kobopatch.yaml config string from UI state

### Frontend - Build Flow

- [ ] User provides firmware zip (file input / drag-and-drop)
- [ ] Load WASM, call `patchFirmware()` with config + firmware + patch files
- [ ] Receive KoboRoot.tgz blob, write to `.kobo/` via File System Access API
- [ ] Fallback: download KoboRoot.tgz manually
- [ ] Bundle patch YAML files as static assets

## Future / Polish

- [ ] Run WASM patching in a Web Worker (avoid blocking UI)
- [ ] Browser compatibility warning with detail
- [ ] Loading/progress states during build
- [ ] Error handling for common failure modes
- [ ] Host as static site (GitHub Pages / Netlify)
- [ ] NickelMenu install/uninstall support (bonus feature)

## Architecture Change Log

- **Switched from PHP backend to fully client-side WASM.**
  Reason: avoid storing Kobo firmware files on a server (legal risk).
  The user provides their own firmware zip. kobopatch runs as WASM in the browser.
  No server needed — can be a static site.
