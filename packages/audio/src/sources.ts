// Procedural, royalty-free demo sources. No files, deterministic (seeded). Peaks sit at −6 dBFS except the calibration tone (−18 dBFS peak).
// Loops are 4 bars at 124 BPM (7.742 s); the length is rounded to a whole sample, so the seam is off by < 1 sample.
export type SourceId = 'drums' | 'bass' | 'pad' | 'vocal' | 'pink' | 'sweep' | 'tone1k';
export const BPM = 124;
const BEAT = 60 / BPM;
const LOOP_S = 16 * BEAT;
const PEAK = 0.5; // −6 dBFS

export const SOURCES: Record<SourceId, { label: string; loop: boolean; seconds: number }> = {
  drums: { label: 'Drums 124 BPM (kick + hat)', loop: true, seconds: LOOP_S },
  bass: { label: 'Bassline 124 BPM', loop: true, seconds: LOOP_S },
  pad: { label: 'Chord pad (Am7–Fmaj7–C–G)', loop: true, seconds: LOOP_S },
  vocal: { label: 'Vocal-ish formant sweep', loop: true, seconds: LOOP_S },
  pink: { label: 'Pink noise', loop: true, seconds: 4 },
  sweep: { label: 'Sine sweep 20 Hz–20 kHz', loop: false, seconds: 10 },
  tone1k: { label: '1 kHz tone, −18 dBFS peak (calibration)', loop: true, seconds: 1 },
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { // mulberry32 → [-1, 1)
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}
const norm = (x: Float32Array, peak = PEAK) => {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i]! *= peak / m;
  return x;
};
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** One-pole low-pass. */
function lp(x: Float32Array, fc: number, fs: number) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / fs);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i]! - y);
  return x;
}

function drums(fs: number, len: number): Float32Array {
  const x = new Float32Array(len), r = rng(1);
  for (let b = 0; b < 16; b++) { // kick every beat: sine, 150→45 Hz pitch drop, 0.35 s decay
    const i0 = Math.round(b * BEAT * fs);
    let ph = 0;
    for (let i = 0; i < Math.min(0.5 * fs, len - i0); i++) {
      const t = i / fs;
      ph += (2 * Math.PI * (45 + 105 * Math.exp(-t * 30))) / fs;
      x[i0 + i]! += Math.sin(ph) * Math.exp(-t / 0.12) * (t < 0.002 ? t / 0.002 : 1);
    }
  }
  for (let b = 0; b < 16; b++) { // closed hat on the off-beat 8th, high-passed noise, 40 ms
    const i0 = Math.round((b + 0.5) * BEAT * fs);
    let prev = 0;
    for (let i = 0; i < Math.min(0.1 * fs, len - i0); i++) {
      const n = r();
      x[i0 + i]! += 0.35 * (n - prev) * Math.exp(-i / fs / 0.04);
      prev = n;
    }
  }
  return norm(x);
}

const BASS_STEPS = [33, 0, 33, 0, 36, 0, 33, 0, 31, 0, 33, 0, 38, 0, 36, 31]; // A1 minor-ish, 16ths; 0 = rest
function bass(fs: number, len: number): Float32Array {
  const x = new Float32Array(len), step = BEAT / 4;
  for (let s = 0; s < 64; s++) {
    const m = BASS_STEPS[s % 16]!;
    if (!m) continue;
    const i0 = Math.round(s * step * fs), f = midiHz(m);
    for (let i = 0; i < Math.min(Math.round(step * fs * 0.9), len - i0); i++) {
      const t = i / fs, saw = 2 * ((f * t) % 1) - 1;
      x[i0 + i]! += saw * Math.min(1, t / 0.003) * Math.exp(-t / 0.15);
    }
  }
  return norm(lp(x, 400, fs));
}

const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]; // Am7 Fmaj7 Cmaj7 G6-ish
function pad(fs: number, len: number, side: 1 | -1): Float32Array {
  const x = new Float32Array(len), bar = 4 * BEAT;
  CHORDS.forEach((ch, c) => {
    const i0 = Math.round(c * bar * fs), n = Math.round(bar * fs);
    for (const m of ch) for (const det of [0.997, 1.003]) {
      const f = midiHz(m) * (side === 1 ? det : 2 - det);
      for (let i = 0; i < Math.min(n, len - i0); i++) {
        const t = i / fs, env = Math.min(1, t / 0.4, (bar - t) / 0.4);
        x[i0 + i]! += (2 * ((f * t) % 1) - 1) * Math.max(0, env);
      }
    }
  });
  return lp(lp(x, 1800, fs), 1800, fs);
}

function vocal(fs: number, len: number): Float32Array {
  const x = new Float32Array(len);
  // glottal-ish saw at 140 Hz (slow vibrato) through two 2-pole resonators sweeping a → i → u → a
  const vow = [[800, 1200], [300, 2300], [320, 800], [800, 1200]];
  let ph = 0, a1 = 0, a2 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const u = (i / len) * 3, k = Math.min(2, Math.floor(u)), fr = u - k;
    ph += (140 * (1 + 0.01 * Math.sin((2 * Math.PI * 5.5 * i) / fs))) / fs;
    const src = 2 * (ph % 1) - 1;
    let out = 0;
    [0, 1].forEach((f) => {
      const fc = vow[k]![f]! + (vow[k + 1]![f]! - vow[k]![f]!) * fr, bw = 90 + 40 * f;
      const rr = Math.exp((-Math.PI * bw) / fs), c1 = 2 * rr * Math.cos((2 * Math.PI * fc) / fs), c2 = -rr * rr;
      if (f === 0) { const y = (1 - rr) * src + c1 * a1 + c2 * a2; a2 = a1; a1 = y; out += y; }
      else { const y = (1 - rr) * src + c1 * b1 + c2 * b2; b2 = b1; b1 = y; out += 0.6 * y; }
    });
    x[i] = out;
  }
  return x;
}

function pink(len: number, seed: number): Float32Array {
  const x = new Float32Array(len), r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // Paul Kellet refined
  for (let i = 0; i < len; i++) {
    const w = r();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return x;
}

function sweep(fs: number, len: number): Float32Array {
  const x = new Float32Array(len), T = len / fs, f0 = 20, f1 = Math.min(20000, fs / 2 - 100), k = Math.log(f1 / f0);
  for (let i = 0; i < len; i++) x[i] = Math.sin(((2 * Math.PI * f0 * T) / k) * (Math.exp((k * i) / len) - 1));
  return norm(x);
}

/** [L, R] at `fs`. `seconds` defaults to SOURCES[id].seconds. */
export function renderSource(id: SourceId, fs = 44100, seconds = SOURCES[id].seconds): [Float32Array, Float32Array] {
  const len = Math.round(seconds * fs);
  switch (id) {
    case 'drums': { const m = drums(fs, len); return [m, m.slice()]; }
    case 'bass': { const m = bass(fs, len); return [m, m.slice()]; }
    case 'pad': return [norm(pad(fs, len, 1)), norm(pad(fs, len, -1))];
    case 'vocal': { const m = norm(vocal(fs, len)); return [m, m.slice()]; }
    case 'pink': return [norm(pink(len, 7)), norm(pink(len, 8))];
    case 'sweep': { const m = sweep(fs, len); return [m, m.slice()]; }
    case 'tone1k': {
      const m = new Float32Array(len);
      for (let i = 0; i < len; i++) m[i] = 10 ** (-18 / 20) * Math.sin((2 * Math.PI * 1000 * i) / fs);
      return [m, m.slice()];
    }
  }
}

export function toAudioBuffer(ctx: BaseAudioContext, data: [Float32Array, Float32Array]): AudioBuffer {
  const buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
  buf.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
  return buf;
}

/** Start a source (looping where `SOURCES[id].loop`) into `dest`. Stop with the returned node. */
export function playSource(ctx: BaseAudioContext, id: SourceId, dest: AudioNode): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = toAudioBuffer(ctx, renderSource(id, ctx.sampleRate));
  s.loop = SOURCES[id].loop;
  s.connect(dest);
  s.start();
  return s;
}
