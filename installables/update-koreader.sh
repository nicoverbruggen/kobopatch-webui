#!/usr/bin/env bash
set -euo pipefail

# Updates KOReader assets in the served dist directory.
# Run this on the production container to update KOReader
# without a full rebuild.
#
# Usage: ./installables/update-koreader.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/../web/dist/koreader"

mkdir -p "$DIST_DIR"

echo "Fetching latest KOReader release info..."
RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/koreader/koreader/releases/latest)
VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name | test("koreader-kobo-.*\\.zip$")) | .browser_download_url')

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ] || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    echo "Error: Could not find KOReader Kobo release"
    exit 1
fi

# Check if we already have this version.
if [ -f "$DIST_DIR/release.json" ]; then
    CURRENT=$(jq -r '.version' "$DIST_DIR/release.json")
    if [ "$CURRENT" = "$VERSION" ]; then
        echo "Already up to date ($VERSION)."
        exit 0
    fi
    echo "Updating from $CURRENT to $VERSION..."
else
    echo "Installing KOReader $VERSION..."
fi

curl -fL --progress-bar -o "$DIST_DIR/koreader-kobo.zip.tmp" "$DOWNLOAD_URL"
mv "$DIST_DIR/koreader-kobo.zip.tmp" "$DIST_DIR/koreader-kobo.zip"
echo "{\"version\":\"$VERSION\"}" > "$DIST_DIR/release.json"

echo "  -> $(du -h "$DIST_DIR/koreader-kobo.zip" | cut -f1)"
echo "Done. KOReader $VERSION is now being served."
