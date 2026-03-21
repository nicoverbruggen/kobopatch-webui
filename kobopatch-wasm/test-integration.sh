#!/bin/bash
set -euo pipefail

# Integration test: runs the full WASM patching pipeline with SHA1 checksum
# validation against a real firmware zip.

cd "$(dirname "$0")"

# Use local Go if available
LOCAL_GO_DIR="$(pwd)/go"
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

FIRMWARE_FILE="${FIRMWARE_ZIP:-$(cd .. && pwd)/tests/cached_assets/kobo-update-4.45.23646.zip}"
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "ERROR: Firmware zip not found at $FIRMWARE_FILE"
    echo "Run ./test.sh from the project root to download test assets."
    exit 1
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
