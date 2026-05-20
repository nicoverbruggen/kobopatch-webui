#!/bin/bash
set -euo pipefail

# E2E integration test: runs the full UI flows in a browser
# and verifies correct behavior for NickelMenu and custom patches.
#
# Usage: ./run-e2e.sh [--headed] [-- <extra playwright args>]
#
# Options:
#   --headed    Run with a visible browser window
#
# Prerequisites:
#   - kobopatch.wasm built (run npm run build:wasm first)
#   - dist built (run npm run build first)
#   - Node dependencies installed automatically
#   - Test assets cached in tests/e2e/cached_assets/ (run npm run test to download)
#   - Installable assets in src/assets/ (set up automatically)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$E2E_DIR/../.." && pwd)"
DIST_DIR="$APP_DIR/dist"
STALE_TEST_NODE_MODULES="$APP_DIR/tests/e2e/node_modules"

PLAYWRIGHT_ARGS=("--reporter=list")

while [[ $# -gt 0 ]]; do
    case "$1" in
        --headed)
            PLAYWRIGHT_ARGS+=("--headed")
            shift
            ;;
        --slow)
            export SLOW_MO=500
            shift
            ;;
        --)
            shift
            PLAYWRIGHT_ARGS+=("$@")
            break
            ;;
        *)
            PLAYWRIGHT_ARGS+=("$1")
            shift
            ;;
    esac
done

# Check WASM is built.
if [ ! -f "$DIST_DIR/index.html" ]; then
    echo "ERROR: dist not found. Run npm run build first, or use npm run test:e2e:fresh."
    exit 1
fi

if [ ! -f "$DIST_DIR/wasm/kobopatch.wasm" ]; then
    echo "ERROR: kobopatch.wasm not found. Run npm run build:wasm first, or use npm run test:e2e:fresh."
    exit 1
fi

# Guard against a dev build of dist/ — the build suite asserts minified output
# (e.g. <style>:root{...}), so a dev/watch build would spuriously fail.
if ! grep -q '<style>:root{' "$DIST_DIR/index.html"; then
    echo "ERROR: dist/ looks like a dev build (critical CSS isn't minified)."
    echo "Run 'npm run build' for a production build, or use 'npm run test:e2e:fresh'."
    exit 1
fi

# Set up installable assets if not present.
"$APP_DIR/tools/installables/setup.sh"

if [ -d "$STALE_TEST_NODE_MODULES" ]; then
    echo "Removing stale tests/node_modules from the former E2E npm package..."
    rm -rf "$STALE_TEST_NODE_MODULES"
fi

# Install dependencies and browser.
npm --prefix "$APP_DIR" install --silent
PLAYWRIGHT="$APP_DIR/node_modules/.bin/playwright"
"$PLAYWRIGHT" install chromium

# Run the tests.
echo "Running E2E integration tests..."
cd "$E2E_DIR"
"$PLAYWRIGHT" test --config "$E2E_DIR/config/playwright.config.js" "${PLAYWRIGHT_ARGS[@]}"
