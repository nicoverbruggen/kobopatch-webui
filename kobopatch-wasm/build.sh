#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/../web"
SRC_DIR="$WEB_DIR/src"
DIST_DIR="$WEB_DIR/dist"
LOCAL_GO_DIR="$SCRIPT_DIR/go"

if [ ! -d "$SCRIPT_DIR/kobopatch-src" ]; then
    echo "Error: kobopatch source not found. Run ./setup.sh first."
    exit 1
fi

# Use local Go if available
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

echo "Building kobopatch WASM..."
cd "$SCRIPT_DIR"
GOOS=js GOARCH=wasm go build -o kobopatch.wasm .

echo "WASM binary size: $(du -h kobopatch.wasm | cut -f1)"

echo "Copying artifacts..."
mkdir -p "$DIST_DIR/wasm"
cp kobopatch.wasm "$DIST_DIR/wasm/kobopatch.wasm"
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/lib/wasm/wasm_exec.js" "$SRC_DIR/js/wasm_exec.js"
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/misc/wasm/wasm_exec.js" "$SRC_DIR/js/wasm_exec.js"
else
    echo "Error: could not find wasm_exec.js in Go SDK (GOROOT=$GOROOT)"
    exit 1
fi

echo "Done."
