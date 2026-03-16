#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Building WASM ==="
"$SCRIPT_DIR/kobopatch-wasm/build.sh"

echo ""
echo "=== Running WASM integration test ==="
"$SCRIPT_DIR/kobopatch-wasm/test-integration.sh"

echo ""
echo "=== Running E2E tests (Playwright) ==="
cd "$SCRIPT_DIR/e2e"
npm test
