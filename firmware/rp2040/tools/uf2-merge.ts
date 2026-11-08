// bun uf2-merge.ts <firmware.uf2> <blob.bin> <out.uf2>  — appends blob at 0x101F0000.
import { readFileSync, writeFileSync } from "node:fs";
import { mergeUf2 } from "../../../packages/core/src/uf2";
const [fw, blobPath, out] = process.argv.slice(2);
const merged = mergeUf2(readFileSync(fw!), readFileSync(blobPath!));
writeFileSync(out!, merged);
console.log(`${out}: ${merged.length / 512} blocks`);
