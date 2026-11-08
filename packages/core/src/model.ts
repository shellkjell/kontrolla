// Behavioural model of CONTRACTS §2. 1 ms scan, controls in spec order, integer math as written.
import { Stimulus } from './physics';
import type { Control, DeviceSim, DeviceSpec, SimOptions } from './types';

const TABLE = [0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0];

interface St {
  first: boolean;
  acc: number;
  lastS: number;
  lastV: number;
  stable: number;
  counter: number;
  on: boolean;
  prev: number;
  q: number;
  value: number;
}

export function createModelDevice(spec: DeviceSpec, opts: SimOptions = {}): DeviceSim {
  const stim = new Stimulus(spec, opts);
  const subs = new Set<(msg: number[], t: number) => void>();
  let now = 0;
  const emit = (msg: number[]) => subs.forEach((cb) => cb(msg, now));
  const state: St[] = spec.controls.map((c) => ({
    first: true, acc: 0, lastS: 0, lastV: 0, stable: 1, counter: 0, on: false, prev: 3, q: 0,
    value: c.kind === 'encoder' ? c.midi.min : 0,
  }));

  const cc = (c: { midi: { channel: number; cc?: number } }, v: number) => emit([0xb0 | (c.midi.channel - 1), c.midi.cc!, v]);

  function button(c: Extract<Control, { kind: 'button' }>, s: St) {
    const raw = stim.pinLevel(c.pin, now);
    if (raw === s.stable) return void (s.counter = 0);
    s.counter++;
    if (c.debounceMs !== 0 && s.counter < c.debounceMs) return;
    s.stable = raw;
    s.counter = 0;
    const pressed = raw === 0;
    let on: boolean;
    if (c.mode === 'toggle') {
      if (!pressed) return;
      s.on = !s.on;
      on = s.on;
    } else on = pressed;
    const m = c.midi;
    const ch = m.channel - 1;
    if (m.type === 'note') emit(on ? [0x90 | ch, m.note, m.velocity] : [0x80 | ch, m.note, 0]);
    else emit([0xb0 | ch, m.cc, on ? m.max : m.min]);
  }

  function analog(c: Extract<Control, { kind: 'pot' | 'fader' }>, s: St) {
    const raw = stim.analogRaw(c.id);
    const k = 256 - c.smoothing;
    s.acc = s.first ? raw << 4 : s.acc + ((((raw << 4) - s.acc) * k) >> 8);
    const sv = s.acc >> 4;
    const { min, max } = c.midi;
    const v = min + Math.floor((sv * (max - min) + 2047) / 4095);
    if (s.first) {
      s.first = false;
      s.lastS = sv;
      s.lastV = v;
    } else if (v !== s.lastV && Math.abs(sv - s.lastS) >= c.deadband) {
      cc(c, v);
      s.lastV = v;
      s.lastS = sv;
    }
  }

  function encoder(c: Extract<Control, { kind: 'encoder' }>, s: St) {
    const cur = (stim.pinLevel(c.pinA, now) << 1) | stim.pinLevel(c.pinB, now);
    s.q += TABLE[(s.prev << 2) | cur]!;
    s.prev = cur;
    let d = 0;
    if (s.q >= 4) d = 1;
    else if (s.q <= -4) d = -1;
    if (!d) return;
    s.q = 0;
    if (c.relative) return cc(c, d > 0 ? 65 : 63);
    const nv = Math.min(c.midi.max, Math.max(c.midi.min, s.value + d));
    if (nv !== s.value) {
      s.value = nv;
      cc(c, nv);
    }
  }

  function scan() {
    spec.controls.forEach((c, i) => {
      const s = state[i]!;
      if (c.kind === 'button') button(c, s);
      else if (c.kind === 'encoder') encoder(c, s);
      else analog(c, s);
    });
  }

  return {
    fidelity: 'model',
    setAnalog: (id, v) => stim.setAnalog(id, v),
    setButton: (id, p) => stim.setButton(id, p, now),
    turnEncoder: (id, n) => stim.turnEncoder(id, n, now),
    async advance(ms) {
      for (let i = 0; i < ms; i++) {
        scan();
        now++;
      }
    },
    onMidi(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}
