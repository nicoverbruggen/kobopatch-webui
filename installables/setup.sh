#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../web/src"

# --- NickelMenu ---
NICKELMENU_DIR="$SRC_DIR/nickelmenu"
if [ "${1:-}" = "--force" ] || [ ! -f "$NICKELMENU_DIR/NickelMenu.zip" ]; then
    mkdir -p "$NICKELMENU_DIR"
    echo "Downloading NickelMenu.zip..."
    curl -fSL -o "$NICKELMENU_DIR/NickelMenu.zip" \
        "https://github.com/nicoverbruggen/NickelMenu/releases/download/fork-v1.0/NickelMenu.zip"
    echo "  -> $(du -h "$NICKELMENU_DIR/NickelMenu.zip" | cut -f1)"
fi

# --- KOReader ---
KOREADER_DIR="$SRC_DIR/koreader"
if [ "${1:-}" = "--force" ] || [ ! -f "$KOREADER_DIR/koreader-kobo.zip" ]; then
    mkdir -p "$KOREADER_DIR"
    echo "Fetching latest KOReader release info..."
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/koreader/koreader/releases/latest)
    VERSION=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r '.assets[] | select(.name | test("koreader-kobo-.*\\.zip$")) | .browser_download_url')

    if [ -z "$VERSION" ] || [ "$VERSION" = "null" ] || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
        echo "Error: Could not find KOReader Kobo release"
        exit 1
    fi

    echo "Downloading KOReader $VERSION..."
    curl -fL --progress-bar -o "$KOREADER_DIR/koreader-kobo.zip" "$DOWNLOAD_URL"
    echo "  -> $(du -h "$KOREADER_DIR/koreader-kobo.zip" | cut -f1)"

    echo "{\"version\":\"$VERSION\"}" > "$KOREADER_DIR/release.json"
fi

# --- Readerly ---
READERLY_DIR="$SRC_DIR/readerly"
if [ "${1:-}" = "--force" ] || [ ! -f "$READERLY_DIR/KF_Readerly.zip" ]; then
    mkdir -p "$READERLY_DIR"
    echo "Fetching latest Readerly release..."
    DOWNLOAD_URL=$(curl -fsSL https://api.github.com/repos/nicoverbruggen/readerly/releases/latest \
        | jq -r '.assets[] | select(.name == "KF_Readerly.zip") | .browser_download_url')

    if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
        echo "Error: Could not find KF_Readerly.zip in latest release"
        exit 1
    fi

    echo "Downloading KF_Readerly.zip..."
    curl -fL --progress-bar -o "$READERLY_DIR/KF_Readerly.zip" "$DOWNLOAD_URL"
    echo "  -> $(du -h "$READERLY_DIR/KF_Readerly.zip" | cut -f1)"
fi

echo ""
echo "Done. All installable assets are ready."
