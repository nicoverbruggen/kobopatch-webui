#!/usr/bin/env bash
set -euo pipefail

# Updates Readerly font assets in the served dist directory.
# Run this on the production container to update Readerly
# without a full rebuild.
#
# Usage: tools/installables/update-readerly.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$APP_DIR/dist/assets"

mkdir -p "$DIST_DIR"

echo "Fetching latest Readerly release info..."
RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/nicoverbruggen/readerly/releases/latest)
VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name == "KF_Readerly.zip") | .browser_download_url')

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ] || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    echo "Error: Could not find KF_Readerly.zip in latest release"
    exit 1
fi

# Check if we already have this version.
if [ -f "$DIST_DIR/readerly-release.json" ]; then
    CURRENT=$(jq -r '.version' "$DIST_DIR/readerly-release.json")
    if [ "$CURRENT" = "$VERSION" ]; then
        echo "Already up to date ($VERSION)."
        exit 0
    fi
    echo "Updating from $CURRENT to $VERSION..."
else
    echo "Installing Readerly $VERSION..."
fi

curl -fL --progress-bar -o "$DIST_DIR/KF_Readerly.zip.tmp" "$DOWNLOAD_URL"
mv "$DIST_DIR/KF_Readerly.zip.tmp" "$DIST_DIR/KF_Readerly.zip"
echo "{\"version\":\"$VERSION\"}" > "$DIST_DIR/readerly-release.json"

echo "  -> $(du -h "$DIST_DIR/KF_Readerly.zip" | cut -f1)"
echo "Done. Readerly $VERSION is now being served."
