#!/bin/bash
set -euo pipefail

# Validate all firmware download URLs in downloads.json via HEAD requests.
# Exits with code 1 if any URL is invalid.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOWNLOADS="$APP_DIR/patches/downloads.json"

# Validate channel-key ordering. Prefix-keyed test/local entries remain tolerated
# by the app, but committed downloads.json should use firmware-channel keys.
node -e "
  const d = require('$DOWNLOADS');
  const channelNumber = key => {
    const match = String(key).match(/^kobo(\d+)$/);
    return match ? Number(match[1]) : null;
  };
  let failed = false;
  for (const [version, val] of Object.entries(d)) {
    if (version.startsWith('_') || typeof val !== 'object' || Array.isArray(val)) continue;
    const keys = Object.keys(val);
    const invalidKeys = keys.filter(key => channelNumber(key) === null);
    if (invalidKeys.length > 0) {
      console.error(\`Firmware downloads for \${version} must be keyed by kobo channel, got: \${invalidKeys.join(', ')}\`);
      failed = true;
      continue;
    }
    const channels = keys;
    const sorted = [...channels].sort((a, b) => channelNumber(b) - channelNumber(a));
    if (channels.join('\n') !== sorted.join('\n')) {
      console.error(\`Firmware channels for \${version} are not sorted descending: \${channels.join(', ')}\`);
      console.error(\`Expected: \${sorted.join(', ')}\`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
"

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
