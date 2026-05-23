#!/bin/bash
set -euo pipefail

# Fresh E2E integration test: removes dist, rebuilds the app artifacts
# needed by Playwright, and runs the browser tests without running the
# standalone WASM integration or patch blacklist suites.
#
# Usage: ./run-e2e-fresh.sh [--headed] [-- <extra playwright args>]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$E2E_DIR/../.." && pwd)"
DIST_DIR="$APP_DIR/dist"
WASM_SRC_DIR="$APP_DIR/tools/kobopatch-wasm/kobopatch-src"

echo "Removing existing dist..."
rm -rf "$DIST_DIR"

echo "Setting up installable assets..."
node "$APP_DIR/tools/installables/installables.mjs" --src --skip-if-present

if [ ! -d "$WASM_SRC_DIR" ]; then
    echo "Setting up kobopatch source..."
    "$APP_DIR/tools/kobopatch-wasm/setup.sh"
fi

echo "Installing dependencies..."
npm install --prefix "$APP_DIR" --silent

echo "Building WASM artifact..."
"$APP_DIR/tools/kobopatch-wasm/build.sh"

echo "Building web app..."
npm --prefix "$APP_DIR" run build

echo "Validating dist resources..."
npm --prefix "$APP_DIR" run validate:dist

echo "Running fresh E2E integration tests..."
"$E2E_DIR/scripts/run-e2e.sh" "$@"
