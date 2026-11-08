// Config blob v3 encoder/decoder, CONTRACTS §1 (RP2040 only).
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

export const BLOB_VERSION = 3;
export const BLOB_MAX = 4096;
export const HEADER_LEN = 44;
export const LED_REC_LEN = 8;
export const PORT_REC_LEN = 8;
export const MUX_REC_LEN = 8;
export const CTRL_REC_LEN = 20;
export const METER_REC_LEN = 8;

const hexRgb = (c: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`encodeConfig: bad LED color "${c}" (want #rrggbb)`);
  const n = parseInt(m[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

export function encodeConfig(spec: DeviceSpec): Uint8Array {
  if (spec.mcu !== 'rp2040-pico') throw new Error('encodeConfig: RP2040 only (Teensy uses a generated sketch)');
  const name = spec.usbProductName;
  if (name.length > 31 || !/^[\x20-\x7e]*$/.test(name)) throw new Error('encodeConfig: usbProductName must be <=31 printable ASCII chars');
  const meters = spec.meters ?? [];
  const total = HEADER_LEN + LED_REC_LEN + PORT_REC_LEN + MUX_REC_LEN * spec.muxes.length + CTRL_REC_LEN * spec.controls.length + METER_REC_LEN * meters.length + 4;
  if (total > BLOB_MAX) throw new Error(`encodeConfig: blob is ${total} B (max ${BLOB_MAX})`);
  if (spec.controls.length > 255 || meters.length > 255) throw new Error('encodeConfig: too many controls/meters');
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, BLOB_MAGIC, true);
  dv.setUint16(4, BLOB_VERSION, true);
  dv.setUint16(6, total, true);
  out[8] = spec.controls.length;
  out[9] = spec.muxes.length;
  out[10] = meters.length;
  for (let i = 0; i < name.length; i++) out[12 + i] = name.charCodeAt(i);

  const need = (n: number | undefined, what: string): number => {
    if (n === undefined) throw new Error(`encodeConfig: missing ${what}`);
    return n;
  };
  let o = HEADER_LEN;
  const leds = spec.leds;
  out[o] = NONE;
  if (leds && leds.count > 0) {
    out[o] = need(leds.pin, 'LED chain pin');
    out[o + 1] = leds.count;
    out[o + 2] = leds.brightness;
  }
  o += LED_REC_LEN;
  out[o] = spec.midiPort?.txPin ?? NONE;
  out[o + 1] = spec.midiPort?.rxPin ?? NONE;
  o += PORT_REC_LEN;
  for (const m of spec.muxes) {
    out[o] = m.sigPin;
    m.selectPins.forEach((p, i) => (out[o + 1 + i] = p));
    out[o + 5] = m.signal === 'digital' ? 1 : 0;
    out[o + 6] = m.enablePin ?? NONE;
    o += MUX_REC_LEN;
  }
  for (const c of spec.controls) {
    const r = out.subarray(o, o + CTRL_REC_LEN);
    r.fill(NONE, 1, 4);
    r[14] = NONE;
    const m = c.midi;
    r[5] = m.type === 'cc' ? 1 : 2;
    r[6] = m.channel - 1;
    r[7] = m.type === 'cc' ? m.cc : m.note;
    r[8] = m.type === 'cc' ? m.min : 0;
    r[9] = m.type === 'cc' ? m.max : m.velocity;
    const muxIdx = (id: string) => {
      const idx = spec.muxes.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error(`encodeConfig: ${c.id} references unknown mux`);
      return idx;
    };
    if (c.kind === 'button') {
      r[0] = 2;
      if (c.mux) {
        r[3] = muxIdx(c.mux.id);
        r[4] = c.mux.channel;
      } else r[1] = need(c.pin, `pin for ${c.id}`);
      r[10] = c.mode === 'toggle' ? 1 : 0;
      r[11] = c.debounceMs;
      if (c.led) {
        r[14] = c.led.index;
        r.set(hexRgb(c.led.color), 15);
      }
    } else if (c.kind === 'encoder') {
      r[0] = 3;
      r[1] = need(c.pinA, `pinA for ${c.id}`);
      r[2] = need(c.pinB, `pinB for ${c.id}`);
      r[10] = c.relative ? 2 : 0;
    } else {
      r[0] = 1;
      if (c.mux) {
        r[3] = muxIdx(c.mux.id);
        r[4] = c.mux.channel;
      } else r[1] = need(c.pin, `pin for ${c.id}`) - 26;
      r[12] = c.deadband;
      r[13] = c.smoothing;
    }
    o += CTRL_REC_LEN;
  }
  for (const mt of meters) {
    out[o] = mt.midi.channel - 1;
    out[o + 1] = mt.midi.cc;
    out[o + 2] = mt.ledStart;
    out[o + 3] = mt.ledCount;
    o += METER_REC_LEN;
  }
  dv.setUint32(o, crc32(out.subarray(0, o)), true);
  return out;
}

export interface DecodedConfig {
  name: string;
  led: { pin: number; count: number; brightness: number };
  port: { tx: number; rx: number };
  muxes: { sig: number; sel: number[]; signal: number; en: number }[];
  controls: {
    kind: number; pinA: number; pinB: number; muxIndex: number; muxChannel: number; midiType: number; channel: number;
    number: number; min: number; max: number; flags: number; debounceMs: number; deadband: number; smoothing: number;
    led: number; rgb: number[];
  }[];
  meters: { channel: number; cc: number; ledStart: number; ledCount: number }[];
}

export function decodeConfig(b: Uint8Array): DecodedConfig {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < HEADER_LEN + LED_REC_LEN + PORT_REC_LEN + 4 || dv.getUint32(0, true) !== BLOB_MAGIC) throw new Error('bad magic');
  if (dv.getUint16(4, true) !== BLOB_VERSION) throw new Error('bad version');
  const total = dv.getUint16(6, true);
  const nc = b[8]!, nm = b[9]!, nt = b[10]!;
  if (total > b.length || total !== HEADER_LEN + LED_REC_LEN + PORT_REC_LEN + MUX_REC_LEN * nm + CTRL_REC_LEN * nc + METER_REC_LEN * nt + 4) throw new Error('bad length');
  if (dv.getUint32(total - 4, true) !== crc32(b.subarray(0, total - 4))) throw new Error('bad crc');
  let end = 12;
  while (end < 44 && b[end] !== 0) end++;
  const name = String.fromCharCode(...b.subarray(12, end));
  let o = HEADER_LEN;
  const led = { pin: b[o]!, count: b[o + 1]!, brightness: b[o + 2]! };
  o += LED_REC_LEN;
  const port = { tx: b[o]!, rx: b[o + 1]! };
  o += PORT_REC_LEN;
  const muxes = [];
  for (let i = 0; i < nm; i++, o += MUX_REC_LEN) muxes.push({ sig: b[o]!, sel: [...b.subarray(o + 1, o + 5)], signal: b[o + 5]!, en: b[o + 6]! });
  const controls = [];
  for (let i = 0; i < nc; i++, o += CTRL_REC_LEN)
    controls.push({
      kind: b[o]!, pinA: b[o + 1]!, pinB: b[o + 2]!, muxIndex: b[o + 3]!, muxChannel: b[o + 4]!, midiType: b[o + 5]!,
      channel: b[o + 6]!, number: b[o + 7]!, min: b[o + 8]!, max: b[o + 9]!, flags: b[o + 10]!, debounceMs: b[o + 11]!,
      deadband: b[o + 12]!, smoothing: b[o + 13]!, led: b[o + 14]!, rgb: [...b.subarray(o + 15, o + 18)],
    });
  const meters = [];
  for (let i = 0; i < nt; i++, o += METER_REC_LEN) meters.push({ channel: b[o]!, cc: b[o + 1]!, ledStart: b[o + 2]!, ledCount: b[o + 3]! });
  return { name, led, port, muxes, controls, meters };
}
