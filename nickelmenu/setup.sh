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

echo ""
echo "Done. Assets written to: $PUBLIC_DIR"
