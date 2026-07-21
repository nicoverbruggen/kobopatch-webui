#!/bin/bash
set -euo pipefail

# Capture screenshots of every wizard step for visual review.
#
# Usage: ./run-screenshots.sh
#
# Output: screenshots/{mobile,desktop}/{manual,connected,edge-cases}/.../*.png (gitignored)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$E2E_DIR/../.." && pwd)"
PLAYWRIGHT="$APP_DIR/node_modules/.bin/playwright"
STALE_TEST_NODE_MODULES="$APP_DIR/tests/e2e/node_modules"

source "$SCRIPT_DIR/env.sh"

cd "$E2E_DIR"
rm -rf screenshots

if [ -d "$STALE_TEST_NODE_MODULES" ]; then
    echo "Removing stale tests/node_modules from the former E2E npm package..."
    rm -rf "$STALE_TEST_NODE_MODULES"
fi

npm --prefix "$APP_DIR" install --silent
npm --prefix "$APP_DIR" run build
"$PLAYWRIGHT" install chromium
"$PLAYWRIGHT" test --config "$E2E_DIR/config/screenshots.config.js" --reporter=list "$@"

echo ""
echo "Screenshots saved to tests/e2e/screenshots/"
