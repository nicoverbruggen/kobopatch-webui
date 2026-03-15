#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$SCRIPT_DIR/kobopatch-src" ]; then
    echo "Error: kobopatch source not found. Run ./setup.sh first."
    exit 1
fi

echo "Building kobopatch WASM..."
cd "$SCRIPT_DIR"
GOOS=js GOARCH=wasm go build -o kobopatch.wasm .

echo "WASM binary size: $(du -h kobopatch.wasm | cut -f1)"
echo ""
echo "Output: $SCRIPT_DIR/kobopatch.wasm"
