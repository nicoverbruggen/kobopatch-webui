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

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CACHED_ASSETS="$PROJECT_DIR/tests/cached_assets"
FIRMWARE_CONFIG="$PROJECT_DIR/tests/firmware-config.js"

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
if [ ! -d "$PROJECT_DIR/kobopatch-wasm/kobopatch-src" ]; then
    "$PROJECT_DIR/kobopatch-wasm/setup.sh"
fi

# Set up installable assets if not present.
"$PROJECT_DIR/installables/setup.sh"

echo "=== Installing web dependencies ==="
cd "$PROJECT_DIR/web" && npm install

echo ""
echo "=== Linting ==="
cd "$PROJECT_DIR/web" && npx eslint .

echo ""
echo "=== Building web app ==="
cd "$PROJECT_DIR/web" && node build.mjs

echo ""
echo "=== Building WASM ==="
"$PROJECT_DIR/kobopatch-wasm/build.sh"

echo ""
echo "=== Validating dist resources ==="
"$PROJECT_DIR/web/validate-dist.sh"

echo ""
echo "=== Running WASM integration test ==="
PRIMARY_FW="$CACHED_ASSETS/kobo-update-$(node -e "console.log(require('$FIRMWARE_CONFIG').primary.version)").zip"
if [ -f "$PRIMARY_FW" ]; then
    "$PROJECT_DIR/kobopatch-wasm/test-integration.sh"
else
    echo "Skipped (firmware not downloaded)"
fi

echo ""
echo "=== Running E2E tests (Playwright) ==="
E2E_ARGS=()
if [ -n "$HEADED" ]; then E2E_ARGS+=("--headed"); fi
if [ -n "$GREP" ]; then E2E_ARGS+=("--" $GREP); fi
if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then E2E_ARGS+=("${EXTRA_ARGS[@]}"); fi
"$PROJECT_DIR/tests/run-e2e.sh" "${E2E_ARGS[@]}"
