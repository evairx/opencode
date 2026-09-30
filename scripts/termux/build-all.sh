#!/usr/bin/env bash
# Build everything for Android / Termux ARM64
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== [1/3] Building libopentui.so for Android ==="
"$SCRIPT_DIR/build-opentui.sh"

echo "=== [2/3] Building OpenCode binary for Android ARM64 ==="
"$SCRIPT_DIR/build-opencode-android.sh"

echo "=== [3/3] Packaging for Termux (.deb, .pkg.tar.xz, .zip) ==="
"$SCRIPT_DIR/make-packages.sh"

echo "=== All Termux build steps completed successfully! ==="
