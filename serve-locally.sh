#!/usr/bin/env bash
set -euo pipefail

DEV_MODE=false
for arg in "$@"; do
    case "$arg" in
        --fake-analytics)
            export UMAMI_WEBSITE_ID="fake"
            export UMAMI_SCRIPT_URL="data:,"
            ;;
        --dev)
            DEV_MODE=true
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
SRC_DIR="$WEB_DIR/src"
DIST_DIR="$WEB_DIR/dist"
WASM_DIR="$SCRIPT_DIR/kobopatch-wasm"

"$SCRIPT_DIR/installables/setup.sh"

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

if [ "$DEV_MODE" = true ]; then
    echo "Serving at http://localhost:8888 (dev mode, watching for changes)"
    NO_CACHE=1 node serve.mjs &
    SERVER_PID=$!
    trap "kill $SERVER_PID 2>/dev/null" EXIT
    node build.mjs --watch
else
    echo "Serving at http://localhost:8888"
    node serve.mjs
fi
