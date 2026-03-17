#!/bin/bash
set -euo pipefail

# E2E integration test: runs the full UI flows in a browser
# and verifies correct behavior for NickelMenu and custom patches.
#
# Usage: ./run-e2e.sh [--headed] [-- <extra playwright args>]
#
# Options:
#   --headed    Run with a visible browser window
#
# Prerequisites:
#   - kobopatch.wasm built (run kobopatch-wasm/build.sh first)
#   - Firmware zip cached at kobopatch-wasm/testdata/ (downloaded automatically)
#   - NickelMenu assets in web/public/nickelmenu/ (set up automatically)

cd "$(dirname "$0")"

PLAYWRIGHT_ARGS=("--reporter=list")

while [[ $# -gt 0 ]]; do
    case "$1" in
        --headed)
            PLAYWRIGHT_ARGS+=("--headed")
            shift
            ;;
        --slow)
            export SLOW_MO=500
            shift
            ;;
        --)
            shift
            PLAYWRIGHT_ARGS+=("$@")
            break
            ;;
        *)
            PLAYWRIGHT_ARGS+=("$1")
            shift
            ;;
    esac
done

FIRMWARE_VERSION="4.45.23646"
FIRMWARE_URL="https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-${FIRMWARE_VERSION}.zip"
FIRMWARE_DIR="../../kobopatch-wasm/testdata"
FIRMWARE_FILE="${FIRMWARE_DIR}/kobo-update-${FIRMWARE_VERSION}.zip"

# Check WASM is built.
if [ ! -f "../../web/public/wasm/kobopatch.wasm" ]; then
    echo "ERROR: kobopatch.wasm not found. Run kobopatch-wasm/build.sh first."
    exit 1
fi

# Set up NickelMenu assets if not present.
NM_DIR="../../web/public/nickelmenu"
if [ ! -f "$NM_DIR/NickelMenu.zip" ] || [ ! -f "$NM_DIR/kobo-config.zip" ]; then
    echo "Setting up NickelMenu assets..."
    ../../nickelmenu/setup.sh
fi

# Download firmware if not cached.
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "Downloading firmware ${FIRMWARE_VERSION} (~150MB)..."
    mkdir -p "$FIRMWARE_DIR"
    curl -fL --progress-bar -o "$FIRMWARE_FILE.tmp" "$FIRMWARE_URL"
    if ! file "$FIRMWARE_FILE.tmp" | grep -q "Zip archive"; then
        echo "ERROR: downloaded file is not a valid zip"
        rm -f "$FIRMWARE_FILE.tmp"
        exit 1
    fi
    mv "$FIRMWARE_FILE.tmp" "$FIRMWARE_FILE"
    echo "Downloaded to $FIRMWARE_FILE"
else
    echo "Using cached firmware: $FIRMWARE_FILE"
fi

# Install dependencies and browser.
npm install --silent
npx playwright install chromium

# Run the tests.
echo "Running E2E integration tests..."
FIRMWARE_ZIP="$(cd ../.. && pwd)/kobopatch-wasm/testdata/kobo-update-${FIRMWARE_VERSION}.zip" \
    npx playwright test "${PLAYWRIGHT_ARGS[@]}"
