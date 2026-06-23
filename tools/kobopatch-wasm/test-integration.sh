#!/bin/bash
set -euo pipefail

# Integration test: runs the full WASM patching pipeline against a real
# firmware zip as a smoke test.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Use local Go if available
LOCAL_GO_DIR="$(pwd)/go"
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
export GOCACHE="${GOCACHE:-$APP_DIR/tmp/go/cache}"
mkdir -p "$GOCACHE"
E2E_DIR="$APP_DIR/tests/e2e"
FIRMWARE_CONFIG="$E2E_DIR/config/firmware-config.js"
PRIMARY=$(node -e "console.log(JSON.stringify(require('$FIRMWARE_CONFIG').primary))")
PRIMARY_VERSION=$(echo "$PRIMARY" | jq -r '.version')
PRIMARY_SOURCE=$(echo "$PRIMARY" | jq -r '.patchesSource')
PATCHES_ZIP="$APP_DIR/dist/patches/$(echo "$PRIMARY" | jq -r '.patches')"
FIRMWARE_FILE="${FIRMWARE_ZIP:-$E2E_DIR/cached_assets/kobo-update-${PRIMARY_VERSION}.zip}"
if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "ERROR: Firmware zip not found at $FIRMWARE_FILE"
    echo "Run 'npm run test' to download test assets."
    exit 1
fi
if [ ! -f "$PATCHES_ZIP" ]; then
    echo "ERROR: Patches zip not found at $PATCHES_ZIP"
    echo "Run 'npm run build' first to build patch zips."
    exit 1
fi

# Generate the kobopatch config from index.json (the patches zip no longer
# ships a kobopatch.yaml). The WASM patcher only reads version + patches.
CONFIG_YAML="$(mktemp)"
trap 'rm -f "$CONFIG_YAML"' EXIT
node "$SCRIPT_DIR/gen-kobopatch-config.mjs" \
    --source "$PRIMARY_SOURCE" --version "$PRIMARY_VERSION" --in "$FIRMWARE_FILE" \
    > "$CONFIG_YAML"

# Find the WASM test executor.
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/go_js_wasm_exec" ]; then
    EXEC="$GOROOT/lib/wasm/go_js_wasm_exec"
elif [ -f "$GOROOT/misc/wasm/go_js_wasm_exec" ]; then
    EXEC="$GOROOT/misc/wasm/go_js_wasm_exec"
else
    echo "ERROR: go_js_wasm_exec not found in GOROOT ($GOROOT)"
    exit 1
fi

echo "Running integration test..."
TEST_ENV=(
    "PATH=$PATH"
    "HOME=${HOME:-$SCRIPT_DIR}"
    "TMPDIR=${TMPDIR:-/tmp}"
    "GOROOT=$GOROOT"
    "FIRMWARE_ZIP=$FIRMWARE_FILE"
    "PATCHES_ZIP=$PATCHES_ZIP"
    "CONFIG_YAML=$CONFIG_YAML"
    "GOOS=js"
    "GOARCH=wasm"
)

if [ -n "${GOPATH:-}" ]; then
    TEST_ENV+=("GOPATH=$GOPATH")
fi
if [ -n "${GOCACHE:-}" ]; then
    TEST_ENV+=("GOCACHE=$GOCACHE")
fi
if [ -n "${XDG_CACHE_HOME:-}" ]; then
    TEST_ENV+=("XDG_CACHE_HOME=$XDG_CACHE_HOME")
fi

env -i "${TEST_ENV[@]}" go test -v -run TestIntegrationPatch -timeout 300s -exec="$EXEC" .
