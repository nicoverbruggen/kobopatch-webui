#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KOBOPATCH_DIR="$SCRIPT_DIR/kobopatch-src"

if [ -d "$KOBOPATCH_DIR" ]; then
    echo "Updating kobopatch source..."
    cd "$KOBOPATCH_DIR"
    git pull
else
    echo "Cloning kobopatch source..."
    git clone https://github.com/pgaskin/kobopatch.git "$KOBOPATCH_DIR"
fi

echo "Copying wasm_exec.js from Go SDK..."
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/lib/wasm/wasm_exec.js" "$SCRIPT_DIR/wasm_exec.js"
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/misc/wasm/wasm_exec.js" "$SCRIPT_DIR/wasm_exec.js"
else
    echo "Error: could not find wasm_exec.js in Go SDK"
    find "$GOROOT" -name "wasm_exec.js" 2>/dev/null
    exit 1
fi

echo ""
echo "Done. kobopatch source is at: $KOBOPATCH_DIR"
echo "wasm_exec.js copied to: $SCRIPT_DIR/wasm_exec.js"
echo ""
echo "Run ./build.sh to compile the WASM binary."
