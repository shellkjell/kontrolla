import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { allocatePins, decodeConfig, EXAMPLES, exportUf2 } from '../src';

test('exportUf2 appends config blocks at 0x101F0000 readable as the blob', () => {
  const fw = new Uint8Array(readFileSync(new URL('../../../firmware/rp2040/dist/kontrolla-rp2040.uf2', import.meta.url)));
  const spec = allocatePins(EXAMPLES.starter!);
  const out = exportUf2(spec, fw);
  const v = new DataView(out.buffer);
  const n = out.length / 512;
  expect(n).toBe(fw.length / 512 + 16);
  const blob = new Uint8Array(4096);
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(i * 512 + 20, true)).toBe(i);
    expect(v.getUint32(i * 512 + 24, true)).toBe(n);
    const addr = v.getUint32(i * 512 + 12, true);
    if (addr >= 0x101f0000) blob.set(out.subarray(i * 512 + 32, i * 512 + 288), addr - 0x101f0000);
  }
  expect(decodeConfig(blob).controls.length).toBe(spec.controls.length);
});
