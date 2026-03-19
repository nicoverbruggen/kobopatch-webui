#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../web/src/nickelmenu"

mkdir -p "$PUBLIC_DIR"

# --- NickelMenu.zip ---
NICKELMENU_URL="https://github.com/nicoverbruggen/NickelMenu/releases/download/experimental/NickelMenu.zip"
echo "Downloading NickelMenu.zip..."
curl -fSL -o "$PUBLIC_DIR/NickelMenu.zip" "$NICKELMENU_URL"
echo "  -> $(du -h "$PUBLIC_DIR/NickelMenu.zip" | cut -f1)"

# --- kobo-config ---
KOBO_CONFIG_DIR="$SCRIPT_DIR/kobo-config"
if [ -d "$KOBO_CONFIG_DIR" ]; then
    echo "Updating kobo-config..."
    cd "$KOBO_CONFIG_DIR"
    git pull
else
    echo "Cloning kobo-config..."
    git clone https://github.com/nicoverbruggen/kobo-config.git "$KOBO_CONFIG_DIR"
fi

# Copy the relevant assets into a zip for the web app.
# Includes: .adds/, .kobo/screensaver/, fonts/
echo "Bundling kobo-config.zip..."
cd "$KOBO_CONFIG_DIR"
zip -r "$PUBLIC_DIR/kobo-config.zip" \
    .adds/ \
    .kobo/screensaver/ \
    fonts/ \
    -x "*.DS_Store"

echo "  -> $(du -h "$PUBLIC_DIR/kobo-config.zip" | cut -f1)"

echo ""
echo "Done. Assets written to: $PUBLIC_DIR"
