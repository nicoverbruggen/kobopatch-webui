#!/bin/bash
set -euo pipefail

# Test all patches against cached firmware using kobopatch -t.
# Iterates over all firmware versions in tests/e2e/config/firmware-config.js,
# builds the native kobopatch binary, and generates blacklist.json.
#
# Usage:
#   test-patches.sh          # regenerate patches/blacklist.json in place
#   test-patches.sh --check  # verify patches/blacklist.json is up to date;
#                              exits non-zero if it would change

CHECK_MODE=0
if [ "${1:-}" = "--check" ]; then
    CHECK_MODE=1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Use local Go if available
LOCAL_GO_DIR="$(pwd)/go"
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
export GOCACHE="${GOCACHE:-$APP_DIR/tmp/go/cache}"
mkdir -p "$GOCACHE"
E2E_DIR="$APP_DIR/tests/e2e"
FIRMWARE_CONFIG="$E2E_DIR/config/firmware-config.js"
CACHED_ASSETS="$E2E_DIR/cached_assets"
PATCHES_DIR="$APP_DIR/patches"
COMMITTED_BLACKLIST="$PATCHES_DIR/blacklist.json"

if [ "$CHECK_MODE" = "1" ]; then
    BLACKLIST_FILE="$(mktemp)"
else
    BLACKLIST_FILE="$COMMITTED_BLACKLIST"
fi

# Build the native kobopatch binary.
echo "=== Building kobopatch ==="
cd kobopatch-src
go build -o ../kobopatch ./kobopatch
cd ..
echo "Built kobopatch successfully."

# Start with an empty blacklist.
echo "{}" > "$BLACKLIST_FILE"

# Iterate over all firmware versions in the config (primary + secondary).
CONFIGS=$(node -e "var c=require('$FIRMWARE_CONFIG'); console.log(JSON.stringify([c.primary, c.secondary]))")
COUNT=$(echo "$CONFIGS" | jq 'length')

for i in $(seq 0 $((COUNT - 1))); do
    ENTRY=$(echo "$CONFIGS" | jq -c ".[$i]")
    VERSION=$(echo "$ENTRY" | jq -r '.version')
    SHORT_VERSION=$(echo "$ENTRY" | jq -r '.shortVersion')
    PATCHES_SOURCE=$(echo "$ENTRY" | jq -r '.patchesSource')

    URL=$(echo "$ENTRY" | jq -r '.url')
    FIRMWARE_FILE="$CACHED_ASSETS/kobo-update-${VERSION}.zip"
    PATCHES_SRC_DIR="$PATCHES_DIR/$PATCHES_SOURCE"

    if [ ! -f "$FIRMWARE_FILE" ]; then
        echo ""
        echo "=== Downloading firmware $VERSION ==="
        mkdir -p "$CACHED_ASSETS"
        curl -fL --progress-bar -o "$FIRMWARE_FILE.tmp" "$URL"
        mv "$FIRMWARE_FILE.tmp" "$FIRMWARE_FILE"
    fi

    if [ ! -d "$PATCHES_SRC_DIR" ]; then
        echo ""
        echo "=== Skipping $VERSION (patches source $PATCHES_SOURCE not found) ==="
        continue
    fi

    # Copy patches to a temp directory. Do not assign to TMPDIR itself:
    # mktemp reads that environment variable, so deleting it here would make the
    # next loop iteration try to create its directory inside a removed path.
    PATCH_TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$PATCH_TMPDIR"' EXIT

    echo ""
    echo "=== Copying patches from $PATCHES_SOURCE ==="
    cp -r "$PATCHES_SRC_DIR"/* "$PATCH_TMPDIR/"

    # Rewrite the config to point at the cached firmware and create output dir.
    sed "s|^in:.*|in: $FIRMWARE_FILE|" "$PATCH_TMPDIR/kobopatch.yaml" > "$PATCH_TMPDIR/kobopatch.yaml.tmp"
    mv "$PATCH_TMPDIR/kobopatch.yaml.tmp" "$PATCH_TMPDIR/kobopatch.yaml"
    mkdir -p "$PATCH_TMPDIR/out"

    # Run patch tests and capture output.
    echo ""
    echo "=== Testing patches against kobo-update-${VERSION}.zip ==="
    echo ""
    OUTPUT=$(./kobopatch -t -f "$FIRMWARE_FILE" "$PATCH_TMPDIR/kobopatch.yaml" 2>&1 || true)
    echo "$OUTPUT"

    # Update blacklist.json with failed patches for this version.
    echo ""
    echo "=== Updating blacklist.json for $SHORT_VERSION ==="
    echo "$OUTPUT" | python3 -c "
import sys, json, os

version = '$SHORT_VERSION'
blacklist_file = '$BLACKLIST_FILE'
tmpdir = '$PATCH_TMPDIR'

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

    rm -rf "$PATCH_TMPDIR"
    trap - EXIT
done

echo ""
if [ "$CHECK_MODE" = "1" ]; then
    echo "=== Checking blacklist.json is up to date ==="
    if ! diff -u "$COMMITTED_BLACKLIST" "$BLACKLIST_FILE"; then
        rm -f "$BLACKLIST_FILE"
        echo ""
        echo "ERROR: patches/blacklist.json is out of date."
        echo "Regenerate with: npm run test:patches"
        exit 1
    fi
    rm -f "$BLACKLIST_FILE"
    echo "blacklist.json is up to date."
else
    echo "=== Blacklist written to $BLACKLIST_FILE ==="
fi
