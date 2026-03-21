#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KOBOPATCH_DIR="$SCRIPT_DIR/kobopatch-src"
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

if [ -d "$KOBOPATCH_DIR" ]; then
    echo "Updating kobopatch source..."
    cd "$KOBOPATCH_DIR"
    git pull
else
    echo "Cloning kobopatch source..."
    git clone https://github.com/pgaskin/kobopatch.git "$KOBOPATCH_DIR"
    cd "$KOBOPATCH_DIR"
    git checkout 6189c54 # update this as updates come out
fi

echo "Copying wasm_exec.js from Go SDK..."
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/lib/wasm/wasm_exec.js" "$SCRIPT_DIR/wasm_exec.js"
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
    cp "$GOROOT/misc/wasm/wasm_exec.js" "$SCRIPT_DIR/wasm_exec.js"
else
    echo "Error: could not find wasm_exec.js in Go SDK"
    echo "GOROOT=$GOROOT"
    exit 1
fi

echo ""
echo "Done. kobopatch source is at: $KOBOPATCH_DIR"
echo "wasm_exec.js copied to: $SCRIPT_DIR/wasm_exec.js"
echo ""
echo "Run ./build.sh to compile the WASM binary."
