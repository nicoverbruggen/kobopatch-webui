#!/bin/bash
set -euo pipefail

# Capture screenshots of every wizard step for visual review.
#
# Usage: ./run-screenshots.sh
#
# Output: screenshots/{mobile,desktop}/{manual-nickelmenu,manual-patches,connected-nickelmenu,connected-patches,edge-cases}/*.png (gitignored)

cd "$(dirname "$0")"

rm -rf screenshots

npx playwright test --config screenshots.config.js --reporter=list "$@"

echo ""
echo "Screenshots saved to tests/e2e/screenshots/"
