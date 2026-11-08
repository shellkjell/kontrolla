#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
TC="$(cd ../.. && pwd)/.toolchain"
export PATH="$TC/gcc/bin:$PATH"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DPICO_TOOLCHAIN_PATH="$TC/gcc" >/dev/null
cmake --build build -j8
mkdir -p dist
for e in bin elf uf2; do cp build/kontrolla-rp2040.$e dist/; done
sz=$(stat -f %z dist/kontrolla-rp2040.bin)
# blob sector starts at flash offset 0x1F0000
[ "$sz" -lt $((0x1F0000)) ] || { echo "image $sz B overlaps config blob at 0x1F0000"; exit 1; }
arm-none-eabi-size dist/kontrolla-rp2040.elf
echo "bin size $sz B < 0x1F0000 OK"
