import { encodeConfig } from './blob';
import type { DeviceSpec } from './types';

const MAGIC0 = 0x0a324655, MAGIC1 = 0x9e5d5157, MAGIC_END = 0x0ab16f30;
const FLAG_FAMILY = 0x2000, RP2040_FAMILY = 0xe48bff56;
const BLOB_ADDR = 0x101f0000, BLOB_SIZE = 4096;

/** Append a config blob (padded to 4 KiB) at 0x101F0000 to a firmware UF2. */
export function mergeUf2(firmwareUf2: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length > BLOB_SIZE) throw new Error('config blob > 4096 B');
  if (firmwareUf2.length % 512) throw new Error('bad uf2 length');
  const fwBlocks = firmwareUf2.length / 512;
  const total = fwBlocks + BLOB_SIZE / 256;
  const out = new Uint8Array(total * 512);
  out.set(firmwareUf2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < fwBlocks; i++) {
    const o = i * 512, addr = v.getUint32(o + 12, true);
    if (v.getUint32(o, true) !== MAGIC0 || v.getUint32(o + 508, true) !== MAGIC_END) throw new Error('bad uf2 block');
    if (addr + 256 > BLOB_ADDR && addr < BLOB_ADDR + BLOB_SIZE) throw new Error('firmware overlaps config region');
  }
  const padded = new Uint8Array(BLOB_SIZE).fill(0xff);
  padded.set(blob);
  for (let i = 0; i < BLOB_SIZE / 256; i++) {
    const o = (fwBlocks + i) * 512;
    v.setUint32(o, MAGIC0, true); v.setUint32(o + 4, MAGIC1, true);
    v.setUint32(o + 8, FLAG_FAMILY, true); v.setUint32(o + 12, BLOB_ADDR + i * 256, true);
    v.setUint32(o + 16, 256, true); v.setUint32(o + 28, RP2040_FAMILY, true);
    out.set(padded.subarray(i * 256, i * 256 + 256), o + 32);
    v.setUint32(o + 508, MAGIC_END, true);
  }
  for (let i = 0; i < total; i++) { v.setUint32(i * 512 + 20, i, true); v.setUint32(i * 512 + 24, total, true); }
  return out;
}

/** Flashable Pico image: generic firmware + this spec's config. */
export const exportUf2 = (spec: DeviceSpec, firmwareUf2: Uint8Array) => mergeUf2(firmwareUf2, encodeConfig(spec));
