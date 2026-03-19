#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/../web"
SRC_DIR="$WEB_DIR/src"
DIST_DIR="$WEB_DIR/dist"

if [ ! -d "$SCRIPT_DIR/kobopatch-src" ]; then
    echo "Error: kobopatch source not found. Run ./setup.sh first."
    exit 1
fi

echo "Building kobopatch WASM..."
cd "$SCRIPT_DIR"
GOOS=js GOARCH=wasm go build -o kobopatch.wasm .

echo "WASM binary size: $(du -h kobopatch.wasm | cut -f1)"

echo "Copying artifacts..."
mkdir -p "$DIST_DIR/wasm"
cp kobopatch.wasm "$DIST_DIR/wasm/kobopatch.wasm"
cp wasm_exec.js "$SRC_DIR/js/wasm_exec.js"

echo "Done."
