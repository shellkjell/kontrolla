/*
 * Shared stimulus layer (CONTRACTS §3). One `Stimulus` holds the physical state of a device:
 *
 *   const s = new Stimulus(spec, opts);          // opts: SimOptions (seed, analogNoiseLsb, buttonBounceMs)
 *   s.setAnalog(id, x01)                         // linear taper, raw = round(clamp(x)*4095)
 *   s.setButton(id, pressed, tMs)                // schedules (bouncing) edges starting at tMs
 *   s.turnEncoder(id, detents, tMs)              // queues 4 transitions/detent, 2 ms apart, after any pending queue
 *
 * Readers (all in simulated ms):
 *   s.pinLevel(gpio, tMs)        -> 0 | 1   digital level (pull-ups: idle = 1, pressed button = 0)
 *   s.digitalMuxLevel(sig, ch, tMs) -> 0 | 1 level on a digital mux SIG pin for select value ch (buttons on a digital mux)
 *   s.adcRaw(gpio, muxCh?)       -> 0..4095 one noisy ADC read. gpio = the analog MCU pin (direct control or mux SIG);
 *                                   muxCh = current select value 0-15 when gpio is a mux SIG. Unwired reads 0.
 *   s.analogRaw(controlId)       -> same read, by control id (used by the model).
 *
 * For rp2040js: on each GPIO input query call pinLevel(gpio, now); on each ADC sample call
 * adcRaw(26 + adcChannel, muxChannelFromSelectPins). Noise uses its own PRNG stream, bounce another;
 * both are mulberry32 seeded from opts.seed (default 1).
 */
import type { DeviceSpec, SimOptions } from './types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CW = [0b01, 0b00, 0b10, 0b11];
const CCW = [0b10, 0b00, 0b01, 0b11];
export const ENCODER_STEP_MS = 2;

interface Ev {
  t: number;
  level: 0 | 1;
}

export class Stimulus {
  private noiseRng: () => number;
  private bounceRng: () => number;
  private raw = new Map<string, number>();
  private sched = new Map<string, Ev[]>();
  private encEnd = new Map<string, number>();
  private adcMap = new Map<string, string>(); // "gpio" or "gpio:ch" -> control id
  private ctl: Map<string, DeviceSpec['controls'][number]>;

  constructor(readonly spec: DeviceSpec, readonly opts: SimOptions = {}) {
    this.ctl = new Map(spec.controls.map((c) => [c.id, c]));
    const seed = opts.seed ?? 1;
    this.noiseRng = mulberry32(seed);
    this.bounceRng = mulberry32(seed ^ 0x9e3779b9);
    for (const c of spec.controls) {
      if (c.kind === 'pot' || c.kind === 'fader') {
        this.raw.set(c.id, 0);
        if (c.mux) {
          const m = spec.muxes.find((x) => x.id === c.mux!.id);
          if (m) this.adcMap.set(`${m.sigPin}:${c.mux.channel}`, c.id);
        } else if (c.pin !== undefined) this.adcMap.set(`${c.pin}`, c.id);
      }
    }
  }

  private push(key: string, ev: Ev) {
    const l = this.sched.get(key) ?? [];
    l.push(ev);
    l.sort((a, b) => a.t - b.t); // stable
    this.sched.set(key, l);
  }

  setAnalog(id: string, x: number): void {
    this.raw.set(id, Math.round(Math.min(1, Math.max(0, x)) * 4095));
  }

  setButton(id: string, pressed: boolean, tMs: number): void {
    const c = this.ctl.get(id);
    if (c?.kind !== 'button') throw new Error(`not a button: ${id}`);
    const final: 0 | 1 = pressed ? 0 : 1;
    const bounce = this.opts.buttonBounceMs ?? 0;
    let key: string;
    if (c.mux) {
      const m = this.spec.muxes.find((x) => x.id === c.mux!.id);
      if (!m) throw new Error(`unknown mux for ${id}`);
      key = `${m.sigPin}:${c.mux.channel}`;
    } else key = `${c.pin}`;
    if (bounce <= 0) return this.push(key, { t: tMs, level: final });
    // first edge at tMs, then 2 or 4 random flips inside the window; the last one lands on `final`
    const extra = 2 * (1 + Math.floor(this.bounceRng() * 2));
    const times = Array.from({ length: extra }, () => tMs + Math.floor(this.bounceRng() * bounce)).sort((a, b) => a - b);
    this.push(key, { t: tMs, level: final });
    times.forEach((t, i) => this.push(key, { t, level: i % 2 === 0 ? ((1 - final) as 0 | 1) : final }));
  }

  turnEncoder(id: string, detents: number, tMs: number): void {
    const c = this.ctl.get(id);
    if (c?.kind !== 'encoder') throw new Error(`not an encoder: ${id}`);
    const seq = detents >= 0 ? CW : CCW;
    let t = Math.max(tMs, this.encEnd.get(id) ?? 0);
    for (let d = 0; d < Math.abs(detents); d++)
      for (const st of seq) {
        t += ENCODER_STEP_MS;
        this.push(`${c.pinA}`, { t, level: (st >> 1) as 0 | 1 });
        this.push(`${c.pinB}`, { t, level: (st & 1) as 0 | 1 });
      }
    this.encEnd.set(id, t);
  }

  private level(key: string, tMs: number): 0 | 1 {
    const l = this.sched.get(key);
    if (!l) return 1;
    for (let i = l.length - 1; i >= 0; i--) if (l[i]!.t <= tMs) return l[i]!.level;
    return 1;
  }

  pinLevel(gpio: number, tMs: number): 0 | 1 {
    return this.level(`${gpio}`, tMs);
  }

  /** Level seen on a digital mux SIG pin (pull-up) while the select lines address `ch`. Idle = 1, pressed = 0. */
  digitalMuxLevel(sigGpio: number, ch: number, tMs: number): 0 | 1 {
    return this.level(`${sigGpio}:${ch}`, tMs);
  }

  analogRaw(id: string): number {
    const n = this.opts.analogNoiseLsb ?? 0;
    const base = this.raw.get(id) ?? 0;
    const noise = n > 0 ? Math.round((this.noiseRng() * 2 - 1) * n) : 0;
    return Math.min(4095, Math.max(0, base + noise));
  }

  adcRaw(gpio: number, muxCh?: number): number {
    const id = this.adcMap.get(muxCh === undefined ? `${gpio}` : `${gpio}:${muxCh}`);
    return id === undefined ? 0 : this.analogRaw(id);
  }
}
