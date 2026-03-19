#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"

# Generate nginx config from template
export PORT
envsubst '${PORT}' < "$SCRIPT_DIR/nginx.conf.template" > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
