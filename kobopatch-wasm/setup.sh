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
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$SCRIPT_DIR/wasm_exec.js"

echo ""
echo "Done. kobopatch source is at: $KOBOPATCH_DIR"
echo "wasm_exec.js copied to: $SCRIPT_DIR/wasm_exec.js"
echo ""
echo "Run ./build.sh to compile the WASM binary."
