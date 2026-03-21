#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../web/src/koreader"

mkdir -p "$PUBLIC_DIR"

echo "Fetching latest KOReader release info..."
RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/koreader/koreader/releases/latest)
VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name | test("koreader-kobo-.*\\.zip$")) | .browser_download_url')

if [ -z "$VERSION" ] || [ "$VERSION" = "null" ] || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    echo "Error: Could not find KOReader Kobo release"
    exit 1
fi

echo "Downloading KOReader $VERSION..."
curl -fL --progress-bar -o "$PUBLIC_DIR/koreader-kobo.zip" "$DOWNLOAD_URL"
echo "  -> $(du -h "$PUBLIC_DIR/koreader-kobo.zip" | cut -f1)"

# Write release metadata so the app knows the version.
echo "{\"version\":\"$VERSION\"}" > "$PUBLIC_DIR/release.json"

echo ""
echo "Done. Assets written to: $PUBLIC_DIR"
