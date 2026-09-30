#!/usr/bin/env bash
# Build libopentui.so for Android aarch64 (Bionic libc)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

OPENTUI_VERSION="${OPENTUI_VERSION:-0.5.10}"
ANDROID_API="${ANDROID_API:-29}"
ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-/opt/android-ndk}}"
ZIG_BIN="${ZIG_BIN:-zig}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/build-termux}"
DIST_DIR="${DIST_DIR:-$WORK_DIR/dist}"

NDK_TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64"
NDK_SYSROOT="$NDK_TOOLCHAIN/sysroot"
BIONIC_SYSROOT_INC="$WORK_DIR/bionic-include"
ZIG_LIBC="$WORK_DIR/bionic-libc.txt"
OPENTUI_LIB="$DIST_DIR/libopentui.so"

echo "=== Building libopentui.so for Android aarch64 (API $ANDROID_API) ==="
mkdir -p "$WORK_DIR" "$DIST_DIR"

src="${OPENTUI_SRC:-$WORK_DIR/opentui-$OPENTUI_VERSION}"
if [ ! -d "$src/.git" ]; then
  echo ">>> Cloning OpenTUI v${OPENTUI_VERSION}..."
  git clone --depth 1 --branch "v${OPENTUI_VERSION}" https://github.com/anomalyco/opentui.git "$src"
fi

echo ">>> Preparing Bionic sysroot include shims..."
rm -rf "$BIONIC_SYSROOT_INC"
mkdir -p "$BIONIC_SYSROOT_INC"
cp -a "$NDK_SYSROOT/usr/include/." "$BIONIC_SYSROOT_INC/"
cp -a "$NDK_SYSROOT/usr/include/aarch64-linux-android/." "$BIONIC_SYSROOT_INC/"
mkdir -p "$BIONIC_SYSROOT_INC/__opentui"

cat > "$BIONIC_SYSROOT_INC/__opentui/miniaudio_shimmed.h" <<'EOF'
#define _Nullable
#define _Nonnull
#include "../miniaudio.h"
EOF

cat > "$BIONIC_SYSROOT_INC/__opentui/Yoga_shimmed.h" <<'EOF'
#define _Nullable
#define _Nonnull
#include "../yoga/yoga/Yoga.h"
EOF

cat > "$ZIG_LIBC" <<EOF
include_dir=$BIONIC_SYSROOT_INC
sys_include_dir=$BIONIC_SYSROOT_INC
crt_dir=$NDK_SYSROOT/usr/lib/aarch64-linux-android/$ANDROID_API
msvc_lib_dir=
kernel32_lib_dir=
gcc_dir=
EOF

export ANDROID_NDK_HOME BIONIC_SYSROOT_INC ZIG_LIBC
cd "$src/packages/native"
echo ">>> Running Zig build for aarch64-linux-android..."
"$ZIG_BIN" build -Dlibrary-target=aarch64-linux-android -Doptimize=ReleaseSafe
cp "lib/aarch64-linux-android/libopentui.so" "$OPENTUI_LIB"

echo ">>> libopentui.so successfully built at $OPENTUI_LIB"
ls -lh "$OPENTUI_LIB"
