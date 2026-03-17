#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WASM_DIR="$SCRIPT_DIR/kobopatch-wasm"

if [ ! -f "$SCRIPT_DIR/web/public/nickelmenu/NickelMenu.zip" ]; then
    echo "NickelMenu assets not found, downloading..."
    "$SCRIPT_DIR/nickelmenu/setup.sh"
fi

if [ ! -f "$SCRIPT_DIR/web/public/wasm/kobopatch.wasm" ]; then
    echo "WASM binary not found, building..."
    if [ ! -d "$WASM_DIR/kobopatch-src" ]; then
        "$WASM_DIR/setup.sh"
    fi
    "$WASM_DIR/build.sh"
fi

echo "Serving at http://localhost:8888"
python3 -m http.server -d "$SCRIPT_DIR/web/public/" 8888
