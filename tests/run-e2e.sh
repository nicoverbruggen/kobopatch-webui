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
#   - kobopatch.wasm built (run kobopatch-wasm/build.sh first)
#   - Test assets cached in tests/cached_assets/ (run ./test.sh to download)
#   - NickelMenu assets in web/src/nickelmenu/ (set up automatically)

cd "$(dirname "$0")"

PROJECT_ROOT="$(cd .. && pwd)"
WEB_DIR="$PROJECT_ROOT/web"
SRC_DIR="$WEB_DIR/src"
DIST_DIR="$WEB_DIR/dist"

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
if [ ! -f "$DIST_DIR/wasm/kobopatch.wasm" ]; then
    echo "ERROR: kobopatch.wasm not found. Run kobopatch-wasm/build.sh first."
    exit 1
fi

# Set up installable assets if not present.
"$PROJECT_ROOT/installables/setup.sh"

# Install dependencies and browser.
npm install --silent
npx playwright install chromium

# Run the tests.
echo "Running E2E integration tests..."
npx playwright test "${PLAYWRIGHT_ARGS[@]}"
