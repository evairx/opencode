#!/usr/bin/env bash
# Package OpenCode for Android / Termux ARM64
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK_DIR="${WORK_DIR:-$REPO_ROOT/build-termux}"
DIST_DIR="${DIST_DIR:-$WORK_DIR/dist}"
PACKAGE_DIR="${PACKAGE_DIR:-$WORK_DIR/packages}"
RELEASE_VERSION="${RELEASE_VERSION:-$(node -p "require('$REPO_ROOT/packages/opencode/package.json').version")}"

BIN="$DIST_DIR/opencode.bin"
LIB="$DIST_DIR/libopentui.so"
OUT="$PACKAGE_DIR"

mkdir -p "$OUT" "$DIST_DIR/flat"
test -x "$BIN" || { echo "Error: $BIN is missing or not executable"; exit 1; }
test -f "$LIB" || { echo "Error: $LIB is missing"; exit 1; }

echo "=== Creating Termux packages for OpenCode v${RELEASE_VERSION} ==="

# ----------------------------------------------------
# 1. Generate Wrapper Script
# ----------------------------------------------------
cat > "$DIST_DIR/flat/opencode" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# opencode - wrapper for OpenCode on Android/Termux
set -eu

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
DIR="$(CDPATH= cd -- "$(dirname "$SELF")" && pwd)"

# Termux environment markers
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"

# Locate native library directory (libopentui.so)
NATIVE_LIB_DIR=""
for candidate in \
    "$DIR/../libexec/opencode" \
    "$PREFIX/libexec/opencode" \
    "$PREFIX/lib" \
    "$DIR"
do
    if [ -f "$candidate/libopentui.so" ]; then
        NATIVE_LIB_DIR="$candidate"
        break
    fi
done

if [ -n "$NATIVE_LIB_DIR" ]; then
    export OPENTUI_LIB_PATH="$NATIVE_LIB_DIR/libopentui.so"
    export LD_LIBRARY_PATH="$NATIVE_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Fallback configurations for Termux
export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER="${OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER:-true}"
export OPENCODE_DISABLE_ANTIGRAVITY="${OPENCODE_DISABLE_ANTIGRAVITY:-true}"

# Locate binary executable
for candidate in \
    "$DIR/../libexec/opencode/opencode.bin" \
    "$PREFIX/libexec/opencode/opencode.bin" \
    "$DIR/opencode.bin"
do
    if [ -x "$candidate" ]; then
        exec "$candidate" "$@"
    fi
done

echo "opencode: error: could not locate opencode.bin" >&2
exit 127
EOF

cp "$BIN" "$DIST_DIR/flat/opencode.bin"
cp "$LIB" "$DIST_DIR/flat/libopentui.so"
chmod 755 "$DIST_DIR/flat/opencode" "$DIST_DIR/flat/opencode.bin"

# ----------------------------------------------------
# 2. Standalone ZIP package
# ----------------------------------------------------
echo ">>> Creating standalone ZIP package..."
ZIP="$OUT/opencode-${RELEASE_VERSION}-android-aarch64.zip"
(cd "$DIST_DIR/flat" && zip -9 -q "$ZIP" opencode opencode.bin libopentui.so)
echo "    Created: $ZIP"

# ----------------------------------------------------
# 3. Pacman package (.pkg.tar.xz)
# ----------------------------------------------------
echo ">>> Creating pacman package..."
STAGE="$OUT/pacman-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/data/data/com.termux/files/usr/bin"
mkdir -p "$STAGE/data/data/com.termux/files/usr/libexec/opencode"

cp "$DIST_DIR/flat/opencode" "$STAGE/data/data/com.termux/files/usr/bin/opencode"
cp "$BIN" "$STAGE/data/data/com.termux/files/usr/libexec/opencode/opencode.bin"
cp "$LIB" "$STAGE/data/data/com.termux/files/usr/libexec/opencode/libopentui.so"
chmod 755 "$STAGE/data/data/com.termux/files/usr/bin/opencode"
chmod 755 "$STAGE/data/data/com.termux/files/usr/libexec/opencode/opencode.bin"

cat > "$STAGE/.PKGINFO" <<EOF
pkgname = opencode
pkgver = ${RELEASE_VERSION}-1
pkgdesc = OpenCode AI coding assistant for Android/Termux (ARM64)
url = https://github.com/evairx/opencode
builddate = $(date +%s)
packager = evairx
size = $(stat -c%s "$BIN" 2>/dev/null || wc -c < "$BIN")
arch = aarch64
license = MIT
depend = ripgrep
EOF

PACMAN_PKG="$OUT/opencode-${RELEASE_VERSION}-1-aarch64.pkg.tar.xz"
(cd "$STAGE" && tar cf - .PKGINFO data | xz -9 > "$PACMAN_PKG")
echo "    Created: $PACMAN_PKG"

# ----------------------------------------------------
# 4. Deb package (.deb)
# ----------------------------------------------------
echo ">>> Creating deb package..."
DEB_STAGE="$OUT/deb-stage"
rm -rf "$DEB_STAGE"
mkdir -p "$DEB_STAGE/data/data/data" "$DEB_STAGE/DEBIAN"
cp -a "$STAGE/data/data/." "$DEB_STAGE/data/data/data/"

cat > "$DEB_STAGE/DEBIAN/control" <<EOF
Package: opencode
Version: ${RELEASE_VERSION}
Architecture: aarch64
Maintainer: evairx
Installed-Size: $(du -sk "$DEB_STAGE/data" | cut -f1)
Depends: ripgrep
Section: utils
Priority: optional
Homepage: https://github.com/evairx/opencode
Description: OpenCode AI coding assistant for Android/Termux (ARM64)
 Standalone build with Antigravity disabled for Termux compatibility.
EOF

printf '2.0\n' > "$DEB_STAGE/debian-binary"
(cd "$DEB_STAGE/data" && tar czf "$DEB_STAGE/data.tar.gz" data)
(cd "$DEB_STAGE/DEBIAN" && tar czf "$DEB_STAGE/control.tar.gz" control)
DEB_PKG="$OUT/opencode_${RELEASE_VERSION}_aarch64.deb"
(cd "$DEB_STAGE" && ar rc "$DEB_PKG" debian-binary control.tar.gz data.tar.gz)
echo "    Created: $DEB_PKG"

# Cleanup staging
rm -rf "$STAGE" "$DEB_STAGE"

# Checksums
(cd "$OUT" && sha256sum "$(basename "$ZIP")" "$(basename "$PACMAN_PKG")" "$(basename "$DEB_PKG")" > SHA256SUMS)
echo ""
echo "=== Packages ready in $OUT ==="
ls -lh "$OUT"
