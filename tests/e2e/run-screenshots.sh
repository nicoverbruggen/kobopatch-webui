#!/bin/bash
set -euo pipefail

# Capture screenshots of every wizard step for visual review.
#
# Usage: ./run-screenshots.sh
#
# Output: screenshots/{mobile,desktop}/{manual-nickelmenu,manual-patches,connected-nickelmenu,connected-patches,edge-cases}/*.png (gitignored)

cd "$(dirname "$0")"

APP_DIR="$(cd ../.. && pwd)"
PLAYWRIGHT="$APP_DIR/node_modules/.bin/playwright"
STALE_TEST_NODE_MODULES="$APP_DIR/tests/e2e/node_modules"

rm -rf screenshots

if [ -d "$STALE_TEST_NODE_MODULES" ]; then
    echo "Removing stale tests/node_modules from the former E2E npm package..."
    rm -rf "$STALE_TEST_NODE_MODULES"
fi

npm --prefix "$APP_DIR" install --silent
"$PLAYWRIGHT" install chromium
"$PLAYWRIGHT" test --config "$APP_DIR/tests/e2e/screenshots.config.js" --reporter=list "$@"

echo ""
echo "Screenshots saved to tests/e2e/screenshots/"
