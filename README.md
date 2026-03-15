# KoboPatch Web UI

A fully client-side web application for applying [kobopatch](https://github.com/pgaskin/kobopatch) patches to Kobo e-readers. No backend required — runs entirely in the browser using WebAssembly.

## Features

- **Auto mode** (Chromium): detect your Kobo model and firmware via the File System Access API, then write the patched file directly back to the device
- **Manual mode** (all browsers): select your model and firmware version from dropdowns, download the result
- Firmware is downloaded automatically from Kobo's servers
- Step-by-step wizard with live build progress
- Patch descriptions and PatchGroup mutual exclusion

## How it works

1. Connect your Kobo via USB (or select your model/firmware manually)
2. Enable/disable patches in the configurator
3. Click **Build** — firmware is fetched from Kobo's CDN, patches are applied via WASM in a Web Worker
4. Write `KoboRoot.tgz` to your device or download it manually
5. Safely eject and reboot your Kobo

## Building

### Prerequisites

- Go 1.21+ (for compiling kobopatch to WASM)

### Setup & build

```bash
cd kobopatch-wasm
./setup.sh    # clones kobopatch source, copies wasm_exec.js
./build.sh    # compiles WASM, copies artifacts to src/public/
```

### Running locally

Any static file server works:

```bash
python3 -m http.server -d src/public/ 8888
```

Then open `http://localhost:8888`.

## Supported devices

Currently supports firmware **4.45.23646** for:

- Kobo Libra Colour
- Kobo Clara BW (N365)
- Kobo Clara BW (P365)
- Kobo Clara Colour

Additional firmware versions can be added by placing patch zips in `src/public/patches/` and updating `index.json` and the firmware URL map in `kobo-device.js`.

## License

kobopatch is by [pgaskin](https://github.com/pgaskin/kobopatch). Patches are community-contributed via [MobileRead](https://www.mobileread.com/).
