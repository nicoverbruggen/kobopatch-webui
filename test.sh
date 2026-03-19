#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Installing web dependencies ==="
cd "$SCRIPT_DIR/web" && npm install

echo ""
echo "=== Building web app ==="
cd "$SCRIPT_DIR/web" && node build.mjs

echo ""
echo "=== Building WASM ==="
"$SCRIPT_DIR/kobopatch-wasm/build.sh"

echo ""
echo "=== Running WASM integration test ==="
"$SCRIPT_DIR/kobopatch-wasm/test-integration.sh"

echo ""
echo "=== Running E2E tests (Playwright) ==="
cd "$SCRIPT_DIR/tests/e2e"
npm test
