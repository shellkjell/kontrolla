// bun mkblob-test.ts <out.bin> — 1 pot (ADC0, CC1 ch0) + 1 button (GPIO15, note 60 vel 100).
import { writeFileSync } from "node:fs";
const crc32 = (b: Uint8Array) => {
  let c = ~0;
  for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
};
const ctrl = (f: number[]) => Uint8Array.from([...f, ...Array(16 - f.length).fill(0)]);
const body = Buffer.alloc(44 + 32);
body.writeUInt32LE(0x314c524b, 0); body.writeUInt16LE(1, 4); body.writeUInt16LE(body.length + 4, 6);
body[8] = 2; body[9] = 0;
body.write("Test Pot+Button", 12, "ascii");
//        kind pinA pinB mux muxCh type ch num min max flags deb dead smooth
body.set(ctrl([1, 0, 0xff, 0xff, 0, 1, 0, 1, 0, 127, 0, 0, 1, 0]), 44);
body.set(ctrl([2, 15, 0xff, 0xff, 0, 2, 0, 60, 0, 100, 0, 5, 0, 0]), 60);
const out = Buffer.alloc(body.length + 4);
body.copy(out); out.writeUInt32LE(crc32(body), body.length);
writeFileSync(process.argv[2], out);
