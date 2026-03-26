#!/bin/bash
set -euo pipefail

# Test all patches against the cached firmware using kobopatch -t.
# This builds the native kobopatch binary, extracts the patch set,
# and runs each patch in test mode to check if it can be applied.

cd "$(dirname "$0")"

# Use local Go if available
LOCAL_GO_DIR="$(pwd)/go"
if [ -x "$LOCAL_GO_DIR/bin/go" ]; then
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

FIRMWARE_FILE="${FIRMWARE_ZIP:-$(cd .. && pwd)/tests/cached_assets/kobo-update-4.45.23646.zip}"
PATCHES_ZIP="${PATCHES_ZIP:-$(cd .. && pwd)/web/src/patches/patches_4.45.zip}"

if [ ! -f "$FIRMWARE_FILE" ]; then
    echo "ERROR: Firmware zip not found at $FIRMWARE_FILE"
    echo "Run ./test.sh from the project root to download test assets first."
    exit 1
fi

if [ ! -f "$PATCHES_ZIP" ]; then
    echo "ERROR: Patches zip not found at $PATCHES_ZIP"
    exit 1
fi

# Build the native kobopatch binary.
echo "=== Building kobopatch ==="
cd kobopatch-src
go build -o ../kobopatch ./kobopatch
cd ..
echo "Built kobopatch successfully."

# Extract patches to a temp directory.
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo ""
echo "=== Extracting patches ==="
unzip -q "$PATCHES_ZIP" -d "$TMPDIR"

# Rewrite the config to point at the cached firmware and create output dir.
sed -i "s|^in:.*|in: $FIRMWARE_FILE|" "$TMPDIR/kobopatch.yaml"
mkdir -p "$TMPDIR/out"

BLACKLIST_FILE="$(cd .. && pwd)/web/src/patches/blacklist.json"
VERSION="${VERSION:-4.45}"

# Run patch tests and capture output.
echo ""
echo "=== Testing patches against $(basename "$FIRMWARE_FILE") ==="
echo ""
OUTPUT=$(./kobopatch -t -f "$FIRMWARE_FILE" "$TMPDIR/kobopatch.yaml" 2>&1 || true)
echo "$OUTPUT"

# Generate blacklist.json from failed patches.
echo ""
echo "=== Generating blacklist.json ==="
echo "$OUTPUT" | python3 -c "
import sys, json, os

version = '$VERSION'
blacklist_file = '$BLACKLIST_FILE'

# Load existing blacklist to preserve other versions.
if os.path.exists(blacklist_file):
    with open(blacklist_file) as f:
        blacklist = json.load(f)
else:
    blacklist = {}

# Map binary paths back to patch file names.
# kobopatch prints 'Patching ./usr/local/Kobo/libnickel.so.1.0.0' but we need 'src/libnickel.so.1.0.0.yaml'.
target_to_src = {}
current_file = None
failed = {}

for line in sys.stdin:
    line = line.rstrip()
    if line.startswith('Patching ./'):
        target = line.split('Patching ./')[1]
        current_file = target
    elif '✕' in line and current_file:
        name = line.split('✕')[1].strip()
        failed.setdefault(current_file, []).append(name)

# Read kobopatch.yaml to get target -> src mapping.
# Parse the 'patches:' section without a YAML dependency.
src_to_target = {}
in_patches = False
with open('$TMPDIR/kobopatch.yaml') as f:
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
    src_path = os.path.join('$TMPDIR', src)
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
print(f'Wrote {total_failed} blacklisted patch(es) for version {version} to {blacklist_file}')
"
