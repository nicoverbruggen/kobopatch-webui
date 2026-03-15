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
- [x] Manual mode fallback for non-Chromium browsers (model + firmware version dropdowns)
- [x] Auto-download firmware from Kobo's servers (CORS confirmed working)
- [x] Firmware download URLs hardcoded per device prefix and version
- [x] Firmware download URL displayed in build step for user verification
- [x] Fixed CRLF line ending bug in patch YAML parser
- [x] Copy `kobopatch.wasm` + `wasm_exec.js` to `src/public/` as part of build
- [x] Progress reporting: download % with MB, WASM log output in terminal window
- [x] WASM `patchFirmware` accepts optional progress callback (4th arg)
- [x] Verified patched binaries are byte-identical between native and WASM builds
- [x] Web Worker for WASM patching (non-blocking UI, live progress)
- [x] Cache-busting timestamp on WASM file (`?ts=` query string)
- [x] Matched log output to native kobopatch (no debug spam from patchfile.Log)
- [x] Step navigation: 3-step indicator (Device → Patches → Build) with back/forward
- [x] Discrete steps with proper state management
- [x] Scrollable patch list (50vh max height with border)
- [x] Toggleable patch descriptions (hidden by default, `?` button)
- [x] UI polish: renamed to "KoboPatch Web UI", styled firmware URL, patch count hint
- [x] Disambiguated identical model names in dropdown (serial prefix suffix)

## To Test

- [ ] End-to-end test in browser with real Kobo device (auto mode)
- [ ] Verify File System Access API write to `.kobo/KoboRoot.tgz`
- [ ] Test manual mode flow across Firefox/Safari/Chrome

## Remaining Work

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
- **Firmware auto-downloaded from Kobo's CDN.**
  `ereaderfiles.kobo.com` serves `Access-Control-Allow-Origin: *`, so direct `fetch()` works.
  User no longer needs to provide firmware manually. URLs hardcoded in `kobo-device.js`.
- **Web Worker for WASM.**
  Moves patching off the main thread so progress updates render live during the build.
  `patch-worker.js` loads `wasm_exec.js` + `kobopatch.wasm`, communicates via `postMessage`.
