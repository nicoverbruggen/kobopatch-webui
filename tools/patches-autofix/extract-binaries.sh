#!/bin/bash
# Extract the patch-target ELF binaries from a cached Kobo firmware zip so they
# can be disassembled (objdump) and probed (finder) while repairing patches.
#
# Usage:
#   extract-binaries.sh <version> [outdir]
#
#   <version>  e.g. 4.45.23697 — must have a cached zip at
#              tests/e2e/cached_assets/kobo-update-<version>.zip
#   [outdir]   where to put usr/local/Kobo/* (default: ./tmp/autofix-bin/<version>)
#
# Prints the extracted binary paths on success.
set -euo pipefail

VERSION="${1:?usage: extract-binaries.sh <version> [outdir]}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FW="$APP_DIR/tests/e2e/cached_assets/kobo-update-${VERSION}.zip"
OUT="${2:-$APP_DIR/tmp/autofix-bin/$VERSION}"

if [ ! -f "$FW" ]; then
    echo "ERROR: firmware not cached: $FW" >&2
    echo "Download it (URL is in tests/e2e/config/firmware-config.js or patches/downloads.json)" >&2
    exit 1
fi

mkdir -p "$OUT"
cd "$OUT"
unzip -o -q "$FW" KoboRoot.tgz
# These are the binaries the patches target. Add more here if a patch set grows.
tar -xzf KoboRoot.tgz \
    usr/local/Kobo/libnickel.so.1.0.0 \
    usr/local/Kobo/libadobe.so \
    usr/local/Kobo/librmsdk.so.1.0.0 \
    usr/local/Kobo/nickel 2>/dev/null || true
rm -f KoboRoot.tgz

echo "Extracted to $OUT:"
find "$OUT/usr/local/Kobo" -type f -maxdepth 1 -print
