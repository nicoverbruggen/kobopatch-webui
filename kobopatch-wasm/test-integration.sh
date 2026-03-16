#!/bin/bash
set -euo pipefail

# Integration test: downloads firmware and runs the full patching pipeline
# with SHA1 checksum validation.
#
# Usage: ./test-integration.sh
#
# The firmware zip (~150MB) is cached in testdata/ to avoid re-downloading.

FIRMWARE_VERSION="4.45.23646"
FIRMWARE_URL="https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-${FIRMWARE_VERSION}.zip"
FIRMWARE_DIR="testdata"
FIRMWARE_FILE="${FIRMWARE_DIR}/kobo-update-${FIRMWARE_VERSION}.zip"

cd "$(dirname "$0")"

# Download firmware if not cached.
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "Downloading firmware ${FIRMWARE_VERSION} (~150MB)..."
    mkdir -p "$FIRMWARE_DIR"
    curl -fL --progress-bar -o "$FIRMWARE_FILE.tmp" "$FIRMWARE_URL"
    # Validate it's actually a zip file.
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

# Find the WASM test executor.
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/go_js_wasm_exec" ]; then
    EXEC="$GOROOT/lib/wasm/go_js_wasm_exec"
elif [ -f "$GOROOT/misc/wasm/go_js_wasm_exec" ]; then
    EXEC="$GOROOT/misc/wasm/go_js_wasm_exec"
else
    echo "ERROR: go_js_wasm_exec not found in GOROOT ($GOROOT)"
    exit 1
fi

echo "Running integration test..."
FIRMWARE_ZIP="$FIRMWARE_FILE" GOOS=js GOARCH=wasm go test -v -run TestIntegrationPatch -timeout 300s -exec="$EXEC" .
