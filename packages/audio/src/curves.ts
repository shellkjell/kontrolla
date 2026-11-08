// CC → value curves, RBJ biquad coefficients and meter mapping. Normative: docs/AUDIO.md. The Teensy sketch re-implements these in C.

export const SAMPLE_RATE = 44100;
export const BLOCK = 128;

export const dbToLin = (db: number) => 10 ** (db / 20);
/** linToDb(0) = -Infinity. */
export const linToDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Channel GAIN: cc 0 = -inf, 1 = -60 dB … 127 = +12 dB (linear in dB; unity at cc 106). */
export const gainDb = (cc: number) => (cc <= 0 ? -Infinity : -60 + ((Math.min(cc, 127) - 1) * 72) / 126);
/** Channel/master FADER: cc 0 = -inf, 1 = -60 dB, 100 = 0 dB, 127 = +6 dB (linear in dB per segment). */
export const faderDb = (cc: number) =>
  cc <= 0 ? -Infinity : cc <= 100 ? -60 + ((cc - 1) * 60) / 99 : ((Math.min(cc, 127) - 100) * 6) / 27;
/** FX SEND, BOOTH, PHONES, FX RETURN: cc 0 = -inf, 1 = -60 dB … 127 = 0 dB. */
export const levelDb = (cc: number) => (cc <= 0 ? -Infinity : -60 + ((Math.min(cc, 127) - 1) * 60) / 126);
/** EQ band: 0 = -26 dB (kill), 62..66 = exactly 0, 127 = +6 dB; linear in dB either side. */
export function eqDb(cc: number): number {
  if (cc >= 62 && cc <= 66) return 0;
  return cc < 62 ? (-26 * (62 - Math.max(cc, 0))) / 62 : (6 * (Math.min(cc, 127) - 66)) / 61;
}

export type FilterMode = { mode: 'off' } | { mode: 'lp' | 'hp'; freq: number };
/** FILTER: 0..61 low-pass 150 Hz..20 kHz (exp), 62..66 off, 67..127 high-pass 20 Hz..3 kHz (exp). */
export function filterMode(cc: number): FilterMode {
  if (cc >= 62 && cc <= 66) return { mode: 'off' };
  if (cc < 62) return { mode: 'lp', freq: 150 * (20000 / 150) ** (Math.max(cc, 0) / 61) };
  return { mode: 'hp', freq: 20 * 150 ** ((Math.min(cc, 127) - 67) / 60) };
}
export const FILTER_Q = 1;

/** PAN position −1 (cc ≤ 1) .. 0 (cc 64) .. +1 (cc 127). */
export const panPos = (cc: number) => Math.max(-1, Math.min(1, (cc - 64) / 63));
/** Mono channel: constant power, centre = −3 dB per side (gL² + gR² = 1). */
export function panMono(cc: number): [number, number] {
  const th = ((panPos(cc) + 1) * Math.PI) / 4;
  return [Math.cos(th), Math.sin(th)];
}
/** Stereo channel: balance, centre = unity; only the far side is attenuated, quarter-sine. */
export function panBalance(cc: number): [number, number] {
  const p = panPos(cc);
  return p <= 0 ? [1, Math.sin(((p + 1) * Math.PI) / 2)] : [Math.cos((p * Math.PI) / 2), 1];
}
/** CUE MIX: 0 = cue only, 127 = master only; equal power. Returns [cueGain, masterGain]. */
export function cueMixGains(cc: number): [number, number] {
  const th = (Math.max(0, Math.min(127, cc)) / 127) * (Math.PI / 2);
  return [Math.cos(th), Math.sin(th)];
}

export const METER_FLOOR_DB = -48;
export const CLIP_DB = -0.1;
/** dBFS → meter CC: −48..0 dBFS → 0..127, linear in dB. */
export const meterCc = (db: number) =>
  Math.round((127 * (Math.max(METER_FLOOR_DB, Math.min(0, db)) - METER_FLOOR_DB)) / -METER_FLOOR_DB);

// ---- RBJ audio-EQ-cookbook biquads (a0 normalised to 1) ----

export interface Coefs { b0: number; b1: number; b2: number; a1: number; a2: number }
export const IDENTITY: Coefs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefs =>
  ({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });

export function peaking(f: number, db: number, q: number, fs = SAMPLE_RATE): Coefs {
  const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return norm(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
}
/** Shelf slope S = 1. */
export function lowShelf(f: number, db: number, fs = SAMPLE_RATE): Coefs {
  const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), s = 2 * Math.sqrt(A) * (Math.sin(w) / Math.SQRT2);
  return norm(
    A * (A + 1 - (A - 1) * c + s), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - s),
    A + 1 + (A - 1) * c + s, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - s,
  );
}
export function highShelf(f: number, db: number, fs = SAMPLE_RATE): Coefs {
  const A = 10 ** (db / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), s = 2 * Math.sqrt(A) * (Math.sin(w) / Math.SQRT2);
  return norm(
    A * (A + 1 + (A - 1) * c + s), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - s),
    A + 1 - (A - 1) * c + s, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - s,
  );
}
export function lowpass(f: number, q: number, fs = SAMPLE_RATE): Coefs {
  const w = (2 * Math.PI * f) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
}
export function highpass(f: number, q: number, fs = SAMPLE_RATE): Coefs {
  const w = (2 * Math.PI * f) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}

/** EQ bands, cascade order. */
export const EQ_BANDS = [
  { param: 'eqLo', make: (db: number, fs: number) => lowShelf(80, db, fs) },
  { param: 'eqLoMid', make: (db: number, fs: number) => peaking(400, db, 0.7, fs) },
  { param: 'eqHiMid', make: (db: number, fs: number) => peaking(2500, db, 0.7, fs) },
  { param: 'eqHi', make: (db: number, fs: number) => highShelf(8000, db, fs) },
] as const;

/** |H| in dB at frequency f. */
export function magDb(c: Coefs, f: number, fs = SAMPLE_RATE): number {
  const w = (2 * Math.PI * f) / fs;
  const re = (a: number, b: number, d: number) => a + b * Math.cos(w) + d * Math.cos(2 * w);
  const im = (b: number, d: number) => -b * Math.sin(w) - d * Math.sin(2 * w);
  const nr = re(c.b0, c.b1, c.b2), ni = im(c.b1, c.b2), dr = re(1, c.a1, c.a2), di = im(c.a1, c.a2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** Transposed direct-form II, float64 state. A bypassed biquad is skipped by the caller (bit-transparent). */
export class Biquad {
  c: Coefs = IDENTITY;
  private z1 = 0;
  private z2 = 0;
  process(x: Float32Array | Float64Array, y: Float32Array | Float64Array, n: number) {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1, z2 = this.z2;
    for (let i = 0; i < n; i++) {
      const v = x[i]!;
      const o = b0 * v + z1;
      z1 = b1 * v - a1 * o + z2;
      z2 = b2 * v - a2 * o;
      y[i] = o;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
  reset() { this.z1 = this.z2 = 0; }
}
