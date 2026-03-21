#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../web/src/readerly"

mkdir -p "$PUBLIC_DIR"

# Get latest release download URL for KF_Readerly.zip
echo "Fetching latest Readerly release..."
DOWNLOAD_URL=$(curl -fsSL https://api.github.com/repos/nicoverbruggen/readerly/releases/latest \
  | jq -r '.assets[] | select(.name == "KF_Readerly.zip") | .browser_download_url')

if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    echo "Error: Could not find KF_Readerly.zip in latest release"
    exit 1
fi

echo "Downloading KF_Readerly.zip..."
curl -fL --progress-bar -o "$PUBLIC_DIR/KF_Readerly.zip" "$DOWNLOAD_URL"
echo "  -> $(du -h "$PUBLIC_DIR/KF_Readerly.zip" | cut -f1)"

echo ""
echo "Done. Assets written to: $PUBLIC_DIR"
