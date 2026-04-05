#!/usr/bin/env bash
set -euo pipefail

# Validate that all required dist resources exist after a full build.
# Called during deployment (nixpacks) to catch missing assets early.

DIST="$(cd "$(dirname "$0")" && pwd)/web/dist"

REQUIRED=(
    "index.html"
    "bundle.js"
    "css/style.css"
    "js/workers/patch-worker.js"
    "js/workers/wasm_exec.js"
    "wasm/kobopatch.wasm"
    "patches/index.json"
    "patches/blacklist.json"
    "patches/downloads.json"
    "nickelmenu/NickelMenu.zip"
    "koreader/koreader-kobo.zip"
    "koreader/release.json"
    "readerly/KF_Readerly.zip"
)

MISSING=0

# Validate each patch zip listed in index.json exists
for filename in $(jq -r '.[].filename' "$DIST/patches/index.json"); do
    if [ ! -f "$DIST/patches/$filename" ]; then
        echo "FAIL: missing patches/$filename (listed in index.json)"
        MISSING=$((MISSING + 1))
    fi
done
for file in "${REQUIRED[@]}"; do
    if [ ! -f "$DIST/$file" ]; then
        echo "FAIL: missing $file"
        MISSING=$((MISSING + 1))
    fi
done

if [ "$MISSING" -gt 0 ]; then
    echo "$MISSING required file(s) missing from dist/"
    exit 1
fi

echo "All required dist resources present."
