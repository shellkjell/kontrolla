// bun uf2-merge.ts <firmware.uf2> <blob.bin> <out.uf2>  — appends blob at 0x101F0000.
import { readFileSync, writeFileSync } from "node:fs";
const [fw, blobPath, out] = process.argv.slice(2);
const old = readFileSync(fw);
const blob = readFileSync(blobPath);
if (blob.length > 4096) throw new Error("blob > 4096 B");
const padded = Buffer.alloc(4096, 0xff);
blob.copy(padded);
const blocks: Buffer[] = [];
for (let o = 0; o < old.length; o += 512) {
  const b = Buffer.from(old.subarray(o, o + 512));
  if (!(b.readUInt32LE(0) === 0x0a324655 && b.readUInt32LE(508) === 0x0ab16f30)) throw new Error("bad uf2");
  if (b.readUInt32LE(12) >= 0x101f0000 && b.readUInt32LE(12) < 0x10200000) throw new Error("fw overlaps blob");
  blocks.push(b);
}
for (let o = 0; o < 4096; o += 256) {
  const b = Buffer.alloc(512);
  b.writeUInt32LE(0x0a324655, 0); b.writeUInt32LE(0x9e5d5157, 4);
  b.writeUInt32LE(0x2000, 8); b.writeUInt32LE(0x101f0000 + o, 12);
  b.writeUInt32LE(256, 16); b.writeUInt32LE(0xe48bff56, 28);
  padded.copy(b, 32, o, o + 256);
  b.writeUInt32LE(0x0ab16f30, 508);
  blocks.push(b);
}
blocks.forEach((b, i) => { b.writeUInt32LE(i, 20); b.writeUInt32LE(blocks.length, 24); });
writeFileSync(out, Buffer.concat(blocks));
console.log(`${out}: ${blocks.length} blocks`);
