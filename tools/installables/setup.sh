#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="$APP_DIR/src"

ASSETS_DIR="$SRC_DIR/assets"

# --- NickelMenu ---
if [ "${1:-}" = "--force" ] || [ ! -f "$ASSETS_DIR/NickelMenu.zip" ]; then
    mkdir -p "$ASSETS_DIR"
    echo "Downloading NickelMenu.zip..."
    curl -fSL -o "$ASSETS_DIR/NickelMenu.zip" \
        "https://github.com/nicoverbruggen/NickelMenu/releases/download/fork-v1.1/NickelMenu.zip"
    echo "  -> $(du -h "$ASSETS_DIR/NickelMenu.zip" | cut -f1)"
fi

# --- KOReader ---
if [ "${1:-}" = "--force" ] || [ ! -f "$ASSETS_DIR/koreader-kobo.zip" ] || [ ! -f "$ASSETS_DIR/koreader-release.json" ]; then
    mkdir -p "$ASSETS_DIR"
    echo "Fetching latest KOReader release info..."
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/koreader/koreader/releases/latest)
    VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name | test("koreader-kobo-.*\\.zip$")) | .browser_download_url')

    if [ -z "$VERSION" ] || [ "$VERSION" = "null" ] || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
        echo "Error: Could not find KOReader Kobo release"
        exit 1
    fi

    echo "Downloading KOReader $VERSION..."
    curl -fL --progress-bar -o "$ASSETS_DIR/koreader-kobo.zip" "$DOWNLOAD_URL"
    echo "  -> $(du -h "$ASSETS_DIR/koreader-kobo.zip" | cut -f1)"

    echo "{\"version\":\"$VERSION\"}" > "$ASSETS_DIR/koreader-release.json"
fi

# --- Readerly ---
if [ "${1:-}" = "--force" ] || [ ! -f "$ASSETS_DIR/KF_Readerly.zip" ]; then
    mkdir -p "$ASSETS_DIR"
    echo "Fetching latest Readerly release..."
    DOWNLOAD_URL=$(curl -fsSL https://api.github.com/repos/nicoverbruggen/readerly/releases/latest \
        | jq -r '.assets[] | select(.name == "KF_Readerly.zip") | .browser_download_url')

    if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
        echo "Error: Could not find KF_Readerly.zip in latest release"
        exit 1
    fi

    echo "Downloading KF_Readerly.zip..."
    curl -fL --progress-bar -o "$ASSETS_DIR/KF_Readerly.zip" "$DOWNLOAD_URL"
    echo "  -> $(du -h "$ASSETS_DIR/KF_Readerly.zip" | cut -f1)"
fi

echo ""
echo "Done. All installable assets are ready."
