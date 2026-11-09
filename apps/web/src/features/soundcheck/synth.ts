import type { Role } from './roles';

const lin = (n: number) => 440 * 2 ** ((n - 69) / 12);
/** A minor pentatonic from A2 upwards: any handful of buttons sounds like music. */
export const noteFor = (index: number, transpose = 0): number => 45 + [0, 3, 5, 7, 10][index % 5]! + 12 * Math.floor(index / 5) + transpose;

type Voice = { osc: OscillatorNode[]; filter: BiquadFilterNode; env: GainNode };
export type ShapeRole = Exclude<Role, 'none' | 'note' | 'drum' | 'pitch'>;

/**
 * A small WebAudio synth, so any controller makes a sound in the browser: a two-oscillator voice through a low-pass filter,
 * a reverb, and a handful of drum voices. Everything ends in a limiter and a volume that starts low.
 */
export class SoundEngine {
  readonly ctx: AudioContext;
  private vol: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private bus: GainNode;
  private analyser: AnalyserNode;
  private voices = new Map<string, Voice>();
  private buf = new Float32Array(1024);
  private p: Record<ShapeRole, number> = { cutoff: 0.6, resonance: 0.2, reverb: 0.25, attack: 0.05, release: 0.3, detune: 0.1, level: 0.8 };
  transpose = 0;

  constructor(volume = 0.25) {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    this.bus = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.8);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.vol = ctx.createGain();
    this.vol.gain.value = volume;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.bus.connect(this.dry).connect(limiter);
    this.bus.connect(verb).connect(this.wet).connect(limiter);
    limiter.connect(this.vol).connect(ctx.destination);
    this.vol.connect(this.analyser);
    this.apply();
  }

  async start() {
    await this.ctx.resume();
    return this.ctx.state === 'running';
  }
  get running() {
    return this.ctx.state === 'running';
  }
  setVolume(v: number) {
    this.vol.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.ctx.currentTime, 0.02);
  }
  /** Peak of what is going to the speakers, 0..1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf as Float32Array<ArrayBuffer>);
    let m = 0;
    for (const v of this.buf) m = Math.max(m, Math.abs(v));
    return m;
  }

  /** x is 0..1 */
  setParam(role: ShapeRole, x: number) {
    this.p[role] = Math.min(1, Math.max(0, x));
    this.apply();
  }
  private cutoffHz = () => 180 * (9000 / 180) ** this.p.cutoff;
  private q = () => 0.5 + this.p.resonance * 14;
  private apply() {
    const t = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(this.p.level * 0.8, t, 0.02);
    this.wet.gain.setTargetAtTime(this.p.reverb * this.p.level * 1.2, t, 0.02);
    for (const v of this.voices.values()) {
      v.filter.frequency.setTargetAtTime(this.cutoffHz(), t, 0.02);
      v.filter.Q.setTargetAtTime(this.q(), t, 0.02);
      v.osc.forEach((o, i) => o.detune.setTargetAtTime((i ? 1 : -1) * this.p.detune * 40, t, 0.02));
    }
  }

  noteOn(id: string, midi: number) {
    this.noteOff(id, true);
    const c = this.ctx;
    const t = c.currentTime;
    const f = lin(midi);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.cutoffHz();
    filter.Q.value = this.q();
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.004 + this.p.attack * 0.7);
    const osc = (['sawtooth', 'square'] as const).map((type, i) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = i ? f / 2 : f;
      o.detune.value = (i ? 1 : -1) * this.p.detune * 40;
      const g = c.createGain();
      g.gain.value = i ? 0.5 : 0.7;
      o.connect(g).connect(filter);
      o.start(t);
      return o;
    });
    filter.connect(env).connect(this.bus);
    this.voices.set(id, { osc, filter, env });
  }
  noteOff(id: string, quick = false) {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    const t = this.ctx.currentTime;
    const rel = quick ? 0.02 : 0.05 + this.p.release * 1.6;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setValueAtTime(v.env.gain.value, t);
    v.env.gain.linearRampToValueAtTime(0, t + rel);
    v.osc.forEach((o) => o.stop(t + rel + 0.05));
  }

  /** i picks the drum: kick, snare, hat, clap, then toms and cymbals. */
  drum(i: number) {
    const c = this.ctx;
    const t = c.currentTime;
    const kind = i % 8;
    const out = c.createGain();
    out.connect(this.bus);
    const noise = (len: number) => {
      const b = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
      const d = b.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      const s = c.createBufferSource();
      s.buffer = b;
      return s;
    };
    const tone = (f0: number, f1: number, len: number, gain: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.8);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.02);
    };
    const hit = (len: number, hz: number, gain: number, type: BiquadFilterType = 'highpass') => {
      const n = noise(len);
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(f).connect(g).connect(out);
      n.start(t);
      n.stop(t + len + 0.02);
    };
    if (kind === 0) tone(150, 42, 0.38, 1.1);
    else if (kind === 1) (tone(220, 120, 0.14, 0.5), hit(0.18, 1800, 0.7));
    else if (kind === 2) hit(0.05, 7000, 0.5);
    else if (kind === 3) (hit(0.03, 1200, 0.8, 'bandpass'), setTimeout(() => this.ctx.state === 'running' && this.clapTail(), 12));
    else if (kind === 4) tone(160, 80, 0.3, 0.9);
    else if (kind === 5) tone(240, 120, 0.26, 0.9);
    else if (kind === 6) hit(0.35, 6000, 0.4);
    else hit(0.05, 2500, 0.6, 'bandpass');
    setTimeout(() => out.disconnect(), 800);
  }
  private clapTail() {
    const c = this.ctx;
    const t = c.currentTime;
    const n = c.createBufferSource();
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * 0.14), c.sampleRate);
    const d = b.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    n.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f).connect(g).connect(this.bus);
    n.start(t);
  }

  private arpTimer = 0;
  /** A looping pentatonic pattern, so knobs have something to shape when there are no note buttons. */
  pattern(on: boolean) {
    clearInterval(this.arpTimer);
    this.arpTimer = 0;
    if (!on) return this.noteOff('pattern');
    const seq = [0, 2, 4, 2, 5, 4, 2, 1];
    let i = 0;
    const step = () => {
      if (!this.running) return;
      const n = noteFor(seq[i % seq.length]! + 5, this.transpose);
      this.noteOn('pattern', n);
      setTimeout(() => this.noteOff('pattern'), 130);
      i++;
    };
    step();
    this.arpTimer = window.setInterval(step, 190);
  }

  dispose() {
    clearInterval(this.arpTimer);
    for (const id of [...this.voices.keys()]) this.noteOff(id, true);
    void this.ctx.close();
  }
}

/** Exponentially decaying noise: a cheap, deterministic-enough room. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return b;
}
