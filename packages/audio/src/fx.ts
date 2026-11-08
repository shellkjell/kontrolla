// Classic Freeverb (Jezar), stereo, float. Same topology as Teensy's AudioEffectFreeverbStereo (roomsize 0.7, damping 0.5).
// Deterministic: no randomness, zero-initialised buffers.

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const SPREAD = 23;
export const REVERB_ROOMSIZE = 0.7;
export const REVERB_DAMPING = 0.5;
const INPUT_GAIN = 0.015;
const WET_SCALE = 3;

class Comb {
  buf: Float32Array; i = 0; store = 0;
  constructor(n: number) { this.buf = new Float32Array(n); }
}

export class Reverb {
  private cl = COMBS.map((n) => new Comb(n));
  private cr = COMBS.map((n) => new Comb(n + SPREAD));
  private al = ALLPASS.map((n) => new Comb(n));
  private ar = ALLPASS.map((n) => new Comb(n + SPREAD));
  private fb = REVERB_ROOMSIZE * 0.28 + 0.7;
  private d1 = REVERB_DAMPING * 0.4;

  /** inL/inR → outL/outR (wet only). */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number) {
    const { fb, d1 } = this, d2 = 1 - d1;
    for (let k = 0; k < n; k++) {
      const x = (inL[k]! + inR[k]!) * INPUT_GAIN;
      let l = 0, r = 0;
      for (const c of this.cl) {
        const o = c.buf[c.i]!;
        c.store = o * d2 + c.store * d1;
        c.buf[c.i] = x + c.store * fb;
        if (++c.i === c.buf.length) c.i = 0;
        l += o;
      }
      for (const c of this.cr) {
        const o = c.buf[c.i]!;
        c.store = o * d2 + c.store * d1;
        c.buf[c.i] = x + c.store * fb;
        if (++c.i === c.buf.length) c.i = 0;
        r += o;
      }
      for (const a of this.al) {
        const b = a.buf[a.i]!;
        a.buf[a.i] = l + b * 0.5;
        l = b - l;
        if (++a.i === a.buf.length) a.i = 0;
      }
      for (const a of this.ar) {
        const b = a.buf[a.i]!;
        a.buf[a.i] = r + b * 0.5;
        r = b - r;
        if (++a.i === a.buf.length) a.i = 0;
      }
      outL[k] = l * WET_SCALE;
      outR[k] = r * WET_SCALE;
    }
  }
}
