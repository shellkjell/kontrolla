import { readFileSync } from 'node:fs';
import { crc32 } from '@kontrolla/core';

export const firmware = new Uint8Array(readFileSync(new URL('../../../firmware/rp2040/dist/kontrolla-rp2040.bin', import.meta.url)));

const ctrl = (f: number[]) => Uint8Array.from([...f, ...Array(20 - f.length).fill(0)]);

/** Hand-built blob v3 (CONTRACTS §1): 1 pot (ADC0, CC1 ch1) + 1 button (GPIO15, note 60 vel 100), no LEDs. */
export function potButtonBlob(corruptCrc = false): Uint8Array {
  const body = Buffer.alloc(44 + 8 + 8 + 40);
  body.writeUInt32LE(0x314c524b, 0);
  body.writeUInt16LE(3, 4);
  body.writeUInt16LE(body.length + 4, 6);
  body[8] = 2;
  body.write('Test Pot+Button', 12, 'ascii');
  body[44] = 0xff; // no LED chain
  body[52] = body[53] = 0xff; // no MIDI port
  //        kind pinA pinB mux muxCh type ch num min max flags deb dead smooth led
  body.set(ctrl([1, 0, 0xff, 0xff, 0, 1, 0, 1, 0, 127, 0, 0, 1, 0, 0xff]), 60);
  body.set(ctrl([2, 15, 0xff, 0xff, 0, 2, 0, 60, 0, 100, 0, 5, 0, 0, 0xff]), 80);
  const out = Buffer.alloc(body.length + 4);
  body.copy(out);
  out.writeUInt32LE((crc32(body) ^ (corruptCrc ? 1 : 0)) >>> 0, body.length);
  return out;
}
