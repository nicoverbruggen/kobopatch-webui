#!/bin/bash
set -euo pipefail

# Test all patches against cached firmware using kobopatch -t.
# Iterates over all firmware versions in tests/firmware-config.js,
# builds the native kobopatch binary, and generates blacklist.json.

cd "$(dirname "$0")"

# Use local Go if available
LOCAL_GO_DIR="$(pwd)/go"
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

FIRMWARE_CONFIG="$(cd .. && pwd)/tests/firmware-config.js"
CACHED_ASSETS="$(cd .. && pwd)/tests/cached_assets"
PATCHES_DIR="$(cd .. && pwd)/web/src/patches"
BLACKLIST_FILE="$PATCHES_DIR/blacklist.json"

# Build the native kobopatch binary.
echo "=== Building kobopatch ==="
cd kobopatch-src
go build -o ../kobopatch ./kobopatch
cd ..
echo "Built kobopatch successfully."

# Start with an empty blacklist.
echo "{}" > "$BLACKLIST_FILE"

# Iterate over all firmware versions in the config (primary + others).
CONFIGS=$(node -e "var c=require('$FIRMWARE_CONFIG'); console.log(JSON.stringify([c.primary, ...c.others]))")
COUNT=$(echo "$CONFIGS" | jq 'length')

for i in $(seq 0 $((COUNT - 1))); do
    ENTRY=$(echo "$CONFIGS" | jq -c ".[$i]")
    VERSION=$(echo "$ENTRY" | jq -r '.version')
    SHORT_VERSION=$(echo "$ENTRY" | jq -r '.shortVersion')
    PATCHES=$(echo "$ENTRY" | jq -r '.patches')

    URL=$(echo "$ENTRY" | jq -r '.url')
    FIRMWARE_FILE="$CACHED_ASSETS/kobo-update-${VERSION}.zip"
    PATCHES_ZIP="$PATCHES_DIR/$PATCHES"

    if [ ! -f "$FIRMWARE_FILE" ]; then
        echo ""
        echo "=== Downloading firmware $VERSION ==="
        mkdir -p "$CACHED_ASSETS"
        curl -fL --progress-bar -o "$FIRMWARE_FILE.tmp" "$URL"
        mv "$FIRMWARE_FILE.tmp" "$FIRMWARE_FILE"
    fi

    if [ ! -f "$PATCHES_ZIP" ]; then
        echo ""
        echo "=== Skipping $VERSION (patches zip $PATCHES not found) ==="
        continue
    fi

    # Extract patches to a temp directory.
    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT

    echo ""
    echo "=== Extracting $PATCHES ==="
    unzip -q "$PATCHES_ZIP" -d "$TMPDIR"

    # Rewrite the config to point at the cached firmware and create output dir.
    sed -i "s|^in:.*|in: $FIRMWARE_FILE|" "$TMPDIR/kobopatch.yaml"
    mkdir -p "$TMPDIR/out"

    # Run patch tests and capture output.
    echo ""
    echo "=== Testing patches against kobo-update-${VERSION}.zip ==="
    echo ""
    OUTPUT=$(./kobopatch -t -f "$FIRMWARE_FILE" "$TMPDIR/kobopatch.yaml" 2>&1 || true)
    echo "$OUTPUT"

    # Update blacklist.json with failed patches for this version.
    echo ""
    echo "=== Updating blacklist.json for $SHORT_VERSION ==="
    echo "$OUTPUT" | python3 -c "
import sys, json, os

version = '$SHORT_VERSION'
blacklist_file = '$BLACKLIST_FILE'
tmpdir = '$TMPDIR'

with open(blacklist_file) as f:
    blacklist = json.load(f)

current_file = None
failed = {}

for line in sys.stdin:
    line = line.rstrip()
    if line.startswith('Patching ./'):
        current_file = line.split('Patching ./')[1]
    elif '✕' in line and current_file:
        name = line.split('✕')[1].strip()
        failed.setdefault(current_file, []).append(name)

# Parse kobopatch.yaml patches section to get target -> src mapping.
src_to_target = {}
in_patches = False
with open(os.path.join(tmpdir, 'kobopatch.yaml')) as f:
    for cfg_line in f:
        cfg_line = cfg_line.rstrip()
        if cfg_line.startswith('patches:'):
            in_patches = True
            continue
        if in_patches and cfg_line and not cfg_line.startswith(' ') and not cfg_line.startswith('#'):
            in_patches = False
        if in_patches:
            parts = cfg_line.strip().split(':')
            if len(parts) >= 2 and parts[0].endswith('.yaml'):
                src_to_target[parts[0].strip()] = parts[1].strip()

# Build a patch-name -> src file mapping by scanning patch files.
patch_name_to_src = {}
for src in src_to_target:
    src_path = os.path.join(tmpdir, src)
    if not os.path.exists(src_path):
        continue
    with open(src_path) as pf:
        for pf_line in pf:
            pf_line = pf_line.rstrip()
            if pf_line and not pf_line.startswith(' ') and not pf_line.startswith('#') and pf_line.endswith(':'):
                patch_name_to_src[pf_line[:-1].strip()] = src

# Build the version entry keyed by src file.
version_entry = {}
for target, patches in sorted(failed.items()):
    for patch in sorted(patches):
        src = patch_name_to_src.get(patch, target)
        version_entry.setdefault(src, []).append(patch)

blacklist[version] = version_entry

with open(blacklist_file, 'w') as f:
    json.dump(blacklist, f, indent=2)
    f.write('\n')

total_failed = sum(len(v) for v in version_entry.values())
print(f'Wrote {total_failed} blacklisted patch(es) for version {version}')
"

    rm -rf "$TMPDIR"
    trap - EXIT
done

echo ""
echo "=== Blacklist written to $BLACKLIST_FILE ==="
