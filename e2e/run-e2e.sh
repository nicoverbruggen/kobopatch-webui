#!/bin/bash
set -euo pipefail

# E2E integration test: runs the full manual-mode patching flow in a browser
# and verifies SHA1 checksums of the patched binaries.
#
# Usage: ./run-e2e.sh
#
# Prerequisites:
#   - kobopatch.wasm built (run kobopatch-wasm/build.sh first)
#   - Firmware zip cached at kobopatch-wasm/testdata/ (downloaded automatically)

cd "$(dirname "$0")"

FIRMWARE_VERSION="4.45.23646"
FIRMWARE_URL="https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-${FIRMWARE_VERSION}.zip"
FIRMWARE_DIR="../kobopatch-wasm/testdata"
FIRMWARE_FILE="${FIRMWARE_DIR}/kobo-update-${FIRMWARE_VERSION}.zip"

# Check WASM is built.
if [ ! -f "../web/public/wasm/kobopatch.wasm" ]; then
    echo "ERROR: kobopatch.wasm not found. Run kobopatch-wasm/build.sh first."
    exit 1
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
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

# Run the test.
echo "Running E2E integration test..."
FIRMWARE_ZIP="$(cd .. && pwd)/kobopatch-wasm/testdata/kobo-update-${FIRMWARE_VERSION}.zip" \
    npx playwright test --reporter=list
