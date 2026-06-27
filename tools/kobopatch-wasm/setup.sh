#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KOBOPATCH_DIR="$SCRIPT_DIR/kobopatch-src"
KOBOPATCH_REF="6189c54"
GO_VERSION="1.23.12"
LOCAL_GO_DIR="$SCRIPT_DIR/go"

# Use system Go if available, otherwise download locally
if command -v go &>/dev/null; then
    echo "Using system Go: $(go version)"
elif [ -x "$LOCAL_GO_DIR/bin/go" ] && "$LOCAL_GO_DIR/bin/go" version 2>/dev/null | grep -q "go${GO_VERSION}"; then
    echo "Using local Go ${GO_VERSION}."
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
else
    # Detect platform and architecture
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *)
            echo "Error: unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    echo "Downloading Go ${GO_VERSION} for ${OS}/${ARCH}..."
    rm -rf "$LOCAL_GO_DIR"
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.${OS}-${ARCH}.tar.gz" | tar -xz -C "$SCRIPT_DIR"
    export GOROOT="$LOCAL_GO_DIR"
    export PATH="$LOCAL_GO_DIR/bin:$PATH"
fi

if [ -d "$KOBOPATCH_DIR/.git" ]; then
    echo "Preparing kobopatch source..."
    cd "$KOBOPATCH_DIR"
else
    echo "Cloning kobopatch source..."
    rm -rf "$KOBOPATCH_DIR"
    git clone https://github.com/pgaskin/kobopatch.git "$KOBOPATCH_DIR"
    cd "$KOBOPATCH_DIR"
fi

if ! git cat-file -e "${KOBOPATCH_REF}^{commit}" 2>/dev/null; then
    git fetch origin "$KOBOPATCH_REF"
fi
git checkout --detach "$KOBOPATCH_REF" # update this as updates come out

# Apply this project's local kobopatch extensions on top of the pinned upstream ref.
# Currently: the `Window` search for ReplaceBytes (offset-independent FindInstBLX/BW),
# which lets patches locate a call by symbol rather than a hardcoded offset so they
# survive firmware updates. The patch is the canonical, reviewable diff of those changes.
DETERMINISM_PATCH="$SCRIPT_DIR/kobopatch-determinism.patch"
if [ -f "$DETERMINISM_PATCH" ]; then
    if git apply --reverse --check "$DETERMINISM_PATCH" 2>/dev/null; then
        echo "Local kobopatch extensions already applied."
    elif git apply --check "$DETERMINISM_PATCH" 2>/dev/null; then
        echo "Applying local kobopatch extensions ($(basename "$DETERMINISM_PATCH"))..."
        git apply "$DETERMINISM_PATCH"
    else
        echo "ERROR: $(basename "$DETERMINISM_PATCH") does not apply to ref ${KOBOPATCH_REF}." >&2
        echo "       Re-generate it after bumping KOBOPATCH_REF (see tools/patches-autofix)." >&2
        exit 1
    fi
fi

echo ""
echo "Done. kobopatch source is at: $KOBOPATCH_DIR"
echo ""
echo "Run ./build.sh to compile the WASM binary."
