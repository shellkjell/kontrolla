#!/usr/bin/env bash
# Reproducible toolchain install into <repo>/.toolchain (gitignored). macOS arm64.
set -euo pipefail
TC="$(cd "$(dirname "$0")/../.." && pwd)/.toolchain"
GCC_VER=15.2.1-1.1
SDK_TAG=2.3.1
mkdir -p "$TC"
if [ ! -x "$TC/gcc/bin/arm-none-eabi-gcc" ]; then
  mkdir -p "$TC/gcc"
  curl -fsSL "https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/v$GCC_VER/xpack-arm-none-eabi-gcc-$GCC_VER-darwin-arm64.tar.gz" \
    | tar -xz -C "$TC/gcc" --strip-components=1
fi
if [ ! -d "$TC/pico-sdk/.git" ]; then
  git clone --depth 1 --branch "$SDK_TAG" https://github.com/raspberrypi/pico-sdk "$TC/pico-sdk"
  git -C "$TC/pico-sdk" submodule update --init --depth 1 lib/tinyusb
fi
"$TC/gcc/bin/arm-none-eabi-gcc" --version | head -1
git -C "$TC/pico-sdk" describe --tags
