#!/usr/bin/env bash
# Build OpenCode binary for Android ARM64
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK_DIR="${WORK_DIR:-$REPO_ROOT/build-termux}"
DIST_DIR="${DIST_DIR:-$WORK_DIR/dist}"
HOST_BUN="${HOST_BUN:-bun}"
OPENCODE_PKG="$REPO_ROOT/packages/opencode"

mkdir -p "$DIST_DIR"

echo "=== Building OpenCode binary for Android/Termux ARM64 ==="

cd "$REPO_ROOT"
"$HOST_BUN" install --ignore-scripts

cd "$OPENCODE_PKG"

# Compile standalone executable with bun
echo ">>> Compiling standalone OpenCode executable for linux-arm64..."
export OPENCODE_DISABLE_ANTIGRAVITY="true"
export OPENCODE_CHANNEL="${OPENCODE_CHANNEL:-termux-arm64}"

"$HOST_BUN" build \
  --conditions=bun,node \
  --tsconfig=./tsconfig.json \
  --external=node-gyp \
  --format=esm \
  --minify \
  --compile \
  --target=bun-linux-arm64 \
  --outfile="$DIST_DIR/opencode.bin" \
  ./src/index.ts

chmod +x "$DIST_DIR/opencode.bin"
echo ">>> OpenCode binary built at $DIST_DIR/opencode.bin"
ls -lh "$DIST_DIR/opencode.bin"
