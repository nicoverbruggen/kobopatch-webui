# TODO

## Done

- [x] Device detection proof of concept (File System Access API)
- [x] Serial prefix → model mapping (verified against official Kobo help page)
- [x] Architecture planning (fully client-side WASM, no backend)
- [x] Installed Go via Homebrew (v1.26.1)
- [x] Verified all kobopatch tests pass natively + WASM
- [x] Created `kobopatch-wasm/` with setup.sh, build.sh, go.mod, main.go
- [x] WASM wrapper compiles successfully (9.9MB)
- [x] GitHub/Gitea CI workflow (build + test)
- [x] Patch UI: loads patches from zip, parses YAML, renders toggles
- [x] PatchGroup mutual exclusion (radio buttons)
- [x] Full app flow: connect → detect → configure patches → upload firmware → build → write/download
- [x] Patches served from `src/public/patches/` with `index.json` for version discovery
- [x] JSZip for client-side zip extraction
- [x] Renamed `src/frontend` → `src/public` (webroot)
- [x] Moved `patches/` into `src/public/patches/`

## To Test

- [ ] End-to-end test in browser with real Kobo device + firmware zip
- [ ] Verify WASM loads and `patchFirmware()` works in browser (not just Node.js)
- [ ] Verify patch YAML parser handles all 6 patch files correctly
- [ ] Verify File System Access API write to `.kobo/KoboRoot.tgz`
- [ ] Verify download fallback works

## Remaining Work

- [ ] Copy `kobopatch.wasm` + `wasm_exec.js` to `src/public/` as part of build
- [ ] Run WASM patching in a Web Worker (avoid blocking UI during build)
- [ ] Loading/progress feedback during WASM load + build
- [ ] Better error messages for common failures
- [ ] Test with multiple firmware versions / patch zips

## Future / Polish

- [ ] Host as static site (GitHub Pages / Netlify)
- [ ] NickelMenu install/uninstall support
- [ ] Dark mode support

## Architecture Change Log

- **Switched from PHP backend to fully client-side WASM.**
  Reason: avoid storing Kobo firmware files on a server (legal risk).
- **Patches served from zip files in `src/public/patches/`.**
  App scans `patches/index.json` to find compatible patch zips for the detected firmware.
  User provides their own firmware zip. kobopatch runs as WASM in the browser.
