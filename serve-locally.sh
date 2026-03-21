#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--fake-analytics" ]]; then
    export UMAMI_WEBSITE_ID="fake"
    export UMAMI_SCRIPT_URL="data:,"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
SRC_DIR="$WEB_DIR/src"
DIST_DIR="$WEB_DIR/dist"
WASM_DIR="$SCRIPT_DIR/kobopatch-wasm"

if [ ! -f "$SRC_DIR/nickelmenu/NickelMenu.zip" ]; then
    echo "NickelMenu assets not found, downloading..."
    "$SCRIPT_DIR/nickelmenu/setup.sh"
fi

if [ ! -f "$SRC_DIR/koreader/koreader-kobo.zip" ]; then
    echo "KOReader assets not found, downloading..."
    "$SCRIPT_DIR/koreader/setup.sh"
fi

if [ ! -f "$SRC_DIR/readerly/KF_Readerly.zip" ]; then
    echo "Readerly font assets not found, downloading..."
    "$SCRIPT_DIR/readerly/setup.sh"
fi

echo "Building JS bundle..."
cd "$WEB_DIR"
npm install --silent
npm run build

if [ ! -f "$DIST_DIR/wasm/kobopatch.wasm" ]; then
    echo "WASM binary not found, building..."
    if [ ! -d "$WASM_DIR/kobopatch-src" ]; then
        "$WASM_DIR/setup.sh"
    fi
    "$WASM_DIR/build.sh"
fi

echo "Serving at http://localhost:8888"
node serve.mjs
