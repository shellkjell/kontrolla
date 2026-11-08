// Config blob encoder/decoder, CONTRACTS §1 (RP2040 only).
import type { DeviceSpec } from './types';

export const BLOB_MAGIC = 0x314c524b;
export const BLOB_FLASH_OFFSET = 0x1f0000;

export function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const NONE = 0xff;

export function encodeConfig(spec: DeviceSpec): Uint8Array {
  if (spec.mcu !== 'rp2040-pico') throw new Error('encodeConfig: RP2040 only (Teensy uses a generated sketch)');
  const name = spec.usbProductName;
  if (name.length > 31 || !/^[\x20-\x7e]*$/.test(name)) throw new Error('encodeConfig: usbProductName must be <=31 printable ASCII chars');
  const total = 44 + 8 * spec.muxes.length + 16 * spec.controls.length + 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, BLOB_MAGIC, true);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, total, true);
  out[8] = spec.controls.length;
  out[9] = spec.muxes.length;
  for (let i = 0; i < name.length; i++) out[12 + i] = name.charCodeAt(i);

  let o = 44;
  for (const m of spec.muxes) {
    out[o] = m.sigPin - 26;
    m.selectPins.forEach((p, i) => (out[o + 1 + i] = p));
    o += 8;
  }
  const need = (n: number | undefined, what: string): number => {
    if (n === undefined) throw new Error(`encodeConfig: missing ${what}`);
    return n;
  };
  for (const c of spec.controls) {
    const r = out.subarray(o, o + 16);
    r.fill(NONE, 1, 4);
    const m = c.midi;
    r[5] = m.type === 'cc' ? 1 : 2;
    r[6] = m.channel - 1;
    r[7] = m.type === 'cc' ? m.cc : m.note;
    r[8] = m.type === 'cc' ? m.min : 0;
    r[9] = m.type === 'cc' ? m.max : m.velocity;
    if (c.kind === 'button') {
      r[0] = 2;
      r[1] = need(c.pin, `pin for ${c.id}`);
      r[10] = c.mode === 'toggle' ? 1 : 0;
      r[11] = c.debounceMs;
    } else if (c.kind === 'encoder') {
      r[0] = 3;
      r[1] = need(c.pinA, `pinA for ${c.id}`);
      r[2] = need(c.pinB, `pinB for ${c.id}`);
      r[10] = c.relative ? 2 : 0;
    } else {
      r[0] = 1;
      if (c.mux) {
        const idx = spec.muxes.findIndex((x) => x.id === c.mux!.id);
        if (idx < 0) throw new Error(`encodeConfig: ${c.id} references unknown mux`);
        r[3] = idx;
        r[4] = c.mux.channel;
      } else r[1] = need(c.pin, `pin for ${c.id}`) - 26;
      r[12] = c.deadband;
      r[13] = c.smoothing;
    }
    o += 16;
  }
  dv.setUint32(o, crc32(out.subarray(0, o)), true);
  return out;
}

export interface DecodedConfig {
  name: string;
  muxes: { sigAdc: number; sel: number[] }[];
  controls: {
    kind: number; pinA: number; pinB: number; muxIndex: number; muxChannel: number; midiType: number; channel: number;
    number: number; min: number; max: number; flags: number; debounceMs: number; deadband: number; smoothing: number;
  }[];
}

export function decodeConfig(b: Uint8Array): DecodedConfig {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 48 || dv.getUint32(0, true) !== BLOB_MAGIC) throw new Error('bad magic');
  if (dv.getUint16(4, true) !== 1) throw new Error('bad version');
  const total = dv.getUint16(6, true);
  if (total > b.length || total < 48) throw new Error('bad length');
  if (dv.getUint32(total - 4, true) !== crc32(b.subarray(0, total - 4))) throw new Error('bad crc');
  const nc = b[8]!, nm = b[9]!;
  let end = 12;
  while (end < 44 && b[end] !== 0) end++;
  const name = String.fromCharCode(...b.subarray(12, end));
  let o = 44;
  const muxes = [];
  for (let i = 0; i < nm; i++, o += 8) muxes.push({ sigAdc: b[o]!, sel: [...b.subarray(o + 1, o + 5)] });
  const controls = [];
  for (let i = 0; i < nc; i++, o += 16)
    controls.push({
      kind: b[o]!, pinA: b[o + 1]!, pinB: b[o + 2]!, muxIndex: b[o + 3]!, muxChannel: b[o + 4]!, midiType: b[o + 5]!,
      channel: b[o + 6]!, number: b[o + 7]!, min: b[o + 8]!, max: b[o + 9]!, flags: b[o + 10]!, debounceMs: b[o + 11]!,
      deadband: b[o + 12]!, smoothing: b[o + 13]!,
    });
  return { name, muxes, controls };
}
