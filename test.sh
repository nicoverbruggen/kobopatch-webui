#!/bin/bash
set -euo pipefail

# Parse flags
HEADED=""
GREP=""
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --headed)
            HEADED="--headed"
            export SLOW_MO=1000
            shift
            ;;
        --test)
            GREP="--grep"
            shift
            ;;
        *)
            if [[ "$GREP" == "--grep" ]]; then
                GREP="--grep $1"
                shift
            else
                EXTRA_ARGS+=("$1")
                shift
            fi
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHED_ASSETS="$SCRIPT_DIR/tests/cached_assets"
FIRMWARE_CONFIG="$SCRIPT_DIR/tests/firmware-config.js"

# Check if any firmware files need to be downloaded.
MISSING=()
while IFS= read -r line; do
    version=$(echo "$line" | jq -r '.version')
    url=$(echo "$line" | jq -r '.url')
    file="$CACHED_ASSETS/kobo-update-${version}.zip"
    if [ ! -f "$file" ]; then
        MISSING+=("$version|$url|$file")
    fi
done < <(node -e "var c=require('$FIRMWARE_CONFIG'); console.log(JSON.stringify([c.primary, ...c.others]))" | jq -c '.[]')

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "The following firmware test assets are not cached locally (~150 MB each):"
    for entry in "${MISSING[@]}"; do
        echo "  - $(echo "$entry" | cut -d'|' -f1)"
    done
    echo ""
    read -rp "Download them now? Tests that need firmware will be skipped otherwise. [y/N] " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        mkdir -p "$CACHED_ASSETS"
        for entry in "${MISSING[@]}"; do
            IFS='|' read -r version url file <<< "$entry"
            echo "Downloading firmware $version..."
            curl -fL --progress-bar -o "$file.tmp" "$url"
            mv "$file.tmp" "$file"
            echo ""
        done
    fi
fi

# Set up kobopatch WASM build dependencies if not present.
if [ ! -d "$SCRIPT_DIR/kobopatch-wasm/kobopatch-src" ]; then
    "$SCRIPT_DIR/kobopatch-wasm/setup.sh"
fi

# Set up installable assets if not present.
"$SCRIPT_DIR/installables/setup.sh"

echo "=== Installing web dependencies ==="
cd "$SCRIPT_DIR/web" && npm install

echo ""
echo "=== Linting ==="
cd "$SCRIPT_DIR/web" && npx eslint .

echo ""
echo "=== Building web app ==="
cd "$SCRIPT_DIR/web" && node build.mjs

echo ""
echo "=== Building WASM ==="
"$SCRIPT_DIR/kobopatch-wasm/build.sh"

echo ""
echo "=== Validating dist resources ==="
"$SCRIPT_DIR/validate-dist.sh"

echo ""
echo "=== Running WASM integration test ==="
PRIMARY_FW="$CACHED_ASSETS/kobo-update-$(node -e "console.log(require('$FIRMWARE_CONFIG').primary.version)").zip"
if [ -f "$PRIMARY_FW" ]; then
    "$SCRIPT_DIR/kobopatch-wasm/test-integration.sh"
else
    echo "Skipped (firmware not downloaded)"
fi

echo ""
echo "=== Running E2E tests (Playwright) ==="
cd "$SCRIPT_DIR/tests"
if [ ! -d "node_modules" ]; then
    npm install
    npx playwright install --with-deps
fi

npx playwright test $HEADED $GREP "${EXTRA_ARGS[@]}"
