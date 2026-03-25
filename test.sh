#!/bin/bash
set -euo pipefail

# Parse flags
HEADED=""
GREP=""
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --headed)
            HEADED="--headed"
            export SLOW_MO=1000
            shift
            ;;
        --test)
            GREP="--grep"
            shift
            ;;
        *)
            if [[ "$GREP" == "--grep" ]]; then
                GREP="--grep $1"
                shift
            else
                EXTRA_ARGS+=("$1")
                shift
            fi
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHED_ASSETS="$SCRIPT_DIR/tests/cached_assets"

FIRMWARE_FILE="$CACHED_ASSETS/kobo-update-4.45.23646.zip"
FIRMWARE_URL="https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-4.45.23646.zip"

# Check if firmware needs to be downloaded.
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "Firmware test asset is not cached locally (~150 MB)."
    echo ""
    read -rp "Download it now? Tests that need the firmware will be skipped otherwise. [y/N] " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        mkdir -p "$CACHED_ASSETS"
        echo "Downloading firmware..."
        curl -fL --progress-bar -o "$FIRMWARE_FILE.tmp" "$FIRMWARE_URL"
        mv "$FIRMWARE_FILE.tmp" "$FIRMWARE_FILE"
        echo ""
    fi
fi

# Set up kobopatch WASM build dependencies if not present.
if [ ! -d "$SCRIPT_DIR/kobopatch-wasm/kobopatch-src" ]; then
    "$SCRIPT_DIR/kobopatch-wasm/setup.sh"
fi

# Set up KOReader assets if not present (served by the app, not a test-only asset).
if [ ! -f "$SCRIPT_DIR/web/src/koreader/koreader-kobo.zip" ]; then
    "$SCRIPT_DIR/koreader/setup.sh"
fi

# Set up Readerly assets if not present.
if [ ! -f "$SCRIPT_DIR/web/src/readerly/KF_Readerly.zip" ]; then
    "$SCRIPT_DIR/readerly/setup.sh"
fi

echo "=== Installing web dependencies ==="
cd "$SCRIPT_DIR/web" && npm install

echo ""
echo "=== Linting ==="
cd "$SCRIPT_DIR/web" && npx eslint .

echo ""
echo "=== Building web app ==="
cd "$SCRIPT_DIR/web" && node build.mjs

echo ""
echo "=== Building WASM ==="
"$SCRIPT_DIR/kobopatch-wasm/build.sh"

echo ""
echo "=== Running WASM integration test ==="
if [ -f "$FIRMWARE_FILE" ]; then
    "$SCRIPT_DIR/kobopatch-wasm/test-integration.sh"
else
    echo "Skipped (firmware not downloaded)"
fi

echo ""
echo "=== Running E2E tests (Playwright) ==="
cd "$SCRIPT_DIR/tests"
if [ ! -d "node_modules" ]; then
    npm install
    npx playwright install --with-deps
fi

npx playwright test $HEADED $GREP "${EXTRA_ARGS[@]}"
