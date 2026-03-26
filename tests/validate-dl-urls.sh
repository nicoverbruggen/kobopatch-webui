#!/bin/bash
set -euo pipefail

# Validate all firmware download URLs in downloads.json via HEAD requests.
# Exits with code 1 if any URL is invalid.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)/../web/src/patches"
DOWNLOADS="$SCRIPT_DIR/downloads.json"

# Extract unique URLs (skip keys starting with _).
URLS=$(node -e "
  const d = require('$DOWNLOADS');
  const seen = new Set();
  for (const [key, val] of Object.entries(d)) {
    if (key.startsWith('_') || typeof val !== 'object') continue;
    for (const url of Object.values(val)) {
      if (!seen.has(url)) { seen.add(url); console.log(url); }
    }
  }
")

FAILED=0
TOTAL=0

while IFS= read -r url; do
  TOTAL=$((TOTAL + 1))
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --head "$url")
  if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 400 ]; then
    echo "  OK  $STATUS  $url"
  else
    echo "FAIL  $STATUS  $url"
    FAILED=$((FAILED + 1))
  fi
done <<< "$URLS"

echo ""
echo "$TOTAL URLs checked, $FAILED failed."
[ "$FAILED" -eq 0 ]
