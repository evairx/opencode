#!/usr/bin/env bash
# Automated OpenCode installer for Termux (Android aarch64)
set -euo pipefail

REPO="evairx/opencode"
BRANCH="${BRANCH:-dev}"
VERSION=""

MUTED='\033[0;2m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}==>${NC} ${CYAN}evairx opencode installer for Android / Termux (ARM64)${NC}"

# Check Termux environment
if [ -z "${TERMUX_VERSION:-}" ] && [ ! -d "/data/data/com.termux" ]; then
    echo -e "${YELLOW}Warning: Not running inside standard Termux environment.${NC}"
fi

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
ARCH="$(uname -m)"

if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
    echo -e "${RED}Error: Unsupported architecture: $ARCH. Termux build requires aarch64 (ARM64).${NC}" >&2
    exit 1
fi

# Ensure ripgrep is installed
if ! command -v rg >/dev/null 2>&1; then
    echo -e "${GREEN}==>${NC} Installing required dependency: ${CYAN}ripgrep${NC}..."
    if command -v pkg >/dev/null 2>&1; then
        pkg install -y ripgrep
    elif command -v pacman >/dev/null 2>&1; then
        pacman -Sy --noconfirm ripgrep
    elif command -v apt-get >/dev/null 2>&1; then
        apt-get update && apt-get install -y ripgrep
    fi
fi

# Detect latest release version if not specified
if [ -z "$VERSION" ]; then
    echo -e "${MUTED}Detecting latest release from GitHub ($REPO)...${NC}"
    LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || true)
    if [ -n "$LATEST_JSON" ]; then
        VERSION=$(echo "$LATEST_JSON" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | cut -d'"' -f4 | sed 's/^v//')
    fi
    if [ -z "$VERSION" ]; then
        VERSION="1.18.29"
    fi
fi

echo -e "${GREEN}==>${NC} Selected OpenCode version: ${CYAN}v${VERSION}${NC}"

mkdir -p "$PREFIX/bin" "$PREFIX/libexec/opencode"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DEB_URL="https://github.com/$REPO/releases/download/v${VERSION}/opencode_${VERSION}_aarch64.deb"
PACMAN_URL="https://github.com/$REPO/releases/download/v${VERSION}/opencode-${VERSION}-1-aarch64.pkg.tar.xz"
ZIP_URL="https://github.com/$REPO/releases/download/v${VERSION}/opencode-${VERSION}-android-aarch64.zip"

INSTALLED=false

# Try package manager installation first if release is accessible
if command -v dpkg >/dev/null 2>&1 && curl -fsSL -I "$DEB_URL" >/dev/null 2>&1; then
    echo -e "${GREEN}==>${NC} Downloading deb package..."
    curl -fsSL -o "$TMP_DIR/opencode.deb" "$DEB_URL"
    dpkg -i "$TMP_DIR/opencode.deb" || apt-get install -f -y
    INSTALLED=true
elif command -v pacman >/dev/null 2>&1 && curl -fsSL -I "$PACMAN_URL" >/dev/null 2>&1; then
    echo -e "${GREEN}==>${NC} Downloading pacman package..."
    curl -fsSL -o "$TMP_DIR/opencode.pkg.tar.xz" "$PACMAN_URL"
    pacman -U --noconfirm "$TMP_DIR/opencode.pkg.tar.xz"
    INSTALLED=true
elif curl -fsSL -I "$ZIP_URL" >/dev/null 2>&1; then
    echo -e "${GREEN}==>${NC} Downloading standalone zip package..."
    curl -fsSL -o "$TMP_DIR/opencode.zip" "$ZIP_URL"
    unzip -q "$TMP_DIR/opencode.zip" -d "$TMP_DIR/out"
    mv "$TMP_DIR/out/opencode" "$PREFIX/bin/opencode"
    mv "$TMP_DIR/out/opencode.bin" "$PREFIX/libexec/opencode/opencode.bin"
    mv "$TMP_DIR/out/libopentui.so" "$PREFIX/libexec/opencode/libopentui.so"
    chmod +x "$PREFIX/bin/opencode" "$PREFIX/libexec/opencode/opencode.bin"
    INSTALLED=true
fi

# If release download was not ready on this fork yet, fallback to community package or show build instructions
if [ "$INSTALLED" = false ]; then
    echo -e "${YELLOW}Notice: Precompiled release asset not yet found at $DEB_URL.${NC}"
    echo -e "${GREEN}==>${NC} Attempting download from mirror..."
    MIRROR_ZIP="https://github.com/guysoft/opencode-termux/releases/download/v1.0.2/opencode2-1.0.2-android-aarch64.zip"
    if curl -fsSL -I "$MIRROR_ZIP" >/dev/null 2>&1; then
        curl -fsSL -o "$TMP_DIR/opencode.zip" "$MIRROR_ZIP"
        unzip -q "$TMP_DIR/opencode.zip" -d "$TMP_DIR/out"
        mv "$TMP_DIR/out/opencode2" "$PREFIX/bin/opencode" || mv "$TMP_DIR/out/opencode" "$PREFIX/bin/opencode"
        mv "$TMP_DIR/out/opencode2.bin" "$PREFIX/libexec/opencode/opencode.bin" || mv "$TMP_DIR/out/opencode.bin" "$PREFIX/libexec/opencode/opencode.bin"
        mv "$TMP_DIR/out/libopentui.so" "$PREFIX/libexec/opencode/libopentui.so"
        chmod +x "$PREFIX/bin/opencode" "$PREFIX/libexec/opencode/opencode.bin"
        INSTALLED=true
    fi
fi

if [ "$INSTALLED" = true ]; then
    echo ""
    echo -e "${GREEN}✔ OpenCode installed successfully on Termux!${NC}"
    echo -e "${MUTED}Binary location:${NC} $PREFIX/bin/opencode"
    echo -e "${MUTED}Note:${NC} Antigravity is disabled on Termux (unsupported by agy). Codex, Claude, OpenAI and all other providers are fully active."
    echo ""
    echo -e "Run OpenCode now:"
    echo -e "  ${CYAN}opencode${NC}"
else
    echo -e "${RED}Error: Could not install binary. You can build it locally with:${NC}"
    echo "  ./scripts/termux/build-all.sh"
    exit 1
fi
