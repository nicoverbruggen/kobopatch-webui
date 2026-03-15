#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$SCRIPT_DIR/kobopatch-src" ]; then
    echo "Error: kobopatch source not found. Run ./setup.sh first."
    exit 1
fi

PUBLIC_DIR="$SCRIPT_DIR/../src/public"

echo "Building kobopatch WASM..."
cd "$SCRIPT_DIR"
GOOS=js GOARCH=wasm go build -o kobopatch.wasm .

echo "WASM binary size: $(du -h kobopatch.wasm | cut -f1)"

# Cache-busting timestamp
TS=$(date +%s)

echo "Copying artifacts to $PUBLIC_DIR..."
cp kobopatch.wasm "$PUBLIC_DIR/kobopatch.wasm"
cp wasm_exec.js "$PUBLIC_DIR/wasm_exec.js"

# Update the cache-busting timestamp in the worker
sed -i "s|kobopatch\.wasm?ts=[0-9]*|kobopatch.wasm?ts=$TS|g" "$PUBLIC_DIR/patch-worker.js"

echo "Build timestamp: $TS"
echo "Done."
