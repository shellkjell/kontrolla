// Behavioural model of CONTRACTS §2. 1 ms scan, controls in spec order, integer math as written.
// Includes host MIDI in (button/meter feedback) and the WS2812 frame, CONTRACTS §2.1/2.2.
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
  ledOn: boolean;
}

export function createModelDevice(spec: DeviceSpec, opts: SimOptions = {}): DeviceSim {
  const stim = new Stimulus(spec, opts);
  const subs = new Set<(msg: number[], t: number) => void>();
  let now = 0;
  const portSubs = new Set<(msg: number[], t: number) => void>();
  const portTx = spec.midiPort?.txPin !== undefined;
  const portRx = spec.midiPort?.rxPin !== undefined;
  // Every USB message is mirrored to the UART port in the same order (CONTRACTS §2.3).
  const emit = (msg: number[]) => {
    subs.forEach((cb) => cb(msg, now));
    if (portTx) portSubs.forEach((cb) => cb(msg, now));
  };
  const state: St[] = spec.controls.map((c) => ({
    first: true, acc: 0, lastS: 0, lastV: 0, stable: 1, counter: 0, on: false, prev: 3, q: 0,
    value: c.kind === 'encoder' ? c.midi.min : 0, ledOn: false,
  }));
  const meters = spec.meters ?? [];
  const lit = meters.map(() => 0);
  const ledCount = spec.leds?.count ?? 0;
  let dirty = false;
  let scanCount = 0;
  const ledSubs = new Set<(rgb: Uint8Array, t: number) => void>();

  const cc = (c: { midi: { channel: number; cc?: number } }, v: number) => emit([0xb0 | (c.midi.channel - 1), c.midi.cc!, v]);

  function button(c: Extract<Control, { kind: 'button' }>, s: St) {
    let raw: 0 | 1;
    if (c.mux) {
      raw = stim.muxLevel(c.mux.id, c.mux.channel, now);
    } else raw = stim.pinLevel(c.pin!, now);
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
    s.ledOn = on;
    dirty = true;
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
    const cur = (stim.pinLevel(c.pinA!, now) << 1) | stim.pinLevel(c.pinB!, now);
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

  /** Scaled RGB for the whole chain (CONTRACTS §2.2). */
  function frame(): Uint8Array {
    const rgb = new Uint8Array(ledCount * 3);
    const put = (i: number, r: number, g: number, b: number) => {
      if (i < 0 || i >= ledCount) return;
      rgb.set([r, g, b], i * 3);
    };
    spec.controls.forEach((c, i) => {
      if (c.kind !== 'button' || !c.led) return;
      const n = parseInt(c.led.color.slice(1), 16);
      const ch = [n >> 16, (n >> 8) & 255, n & 255];
      const sh = state[i]!.ledOn ? 0 : 4;
      put(c.led.index, ch[0]! >> sh, ch[1]! >> sh, ch[2]! >> sh);
    });
    meters.forEach((m, mi) => {
      for (let i = 0; i < m.ledCount; i++) {
        if (i >= lit[mi]!) put(m.ledStart + i, 0, 0, 0);
        else if (i * 10 < m.ledCount * 6) put(m.ledStart + i, 0, 255, 0);
        else if (i * 20 < m.ledCount * 17) put(m.ledStart + i, 255, 160, 0);
        else put(m.ledStart + i, 255, 0, 0);
      }
    });
    const b = spec.leds?.brightness ?? 0;
    for (let i = 0; i < rgb.length; i++) rgb[i] = (rgb[i]! * b) >> 8;
    return rgb;
  }

  function scan() {
    spec.controls.forEach((c, i) => {
      const s = state[i]!;
      if (c.kind === 'button') button(c, s);
      else if (c.kind === 'encoder') encoder(c, s);
      else analog(c, s);
    });
    if (ledCount > 0 && scanCount % 10 === 0 && (dirty || scanCount === 0)) {
      dirty = false;
      const f = frame();
      ledSubs.forEach((cb) => cb(f, now));
    }
    scanCount++;
  }

  /** Host → device MIDI (CONTRACTS §2.1). */
  function sendMidi(msg: number[]) {
    const type = (msg[0] ?? 0) & 0xf0;
    const ch = (msg[0] ?? 0) & 0x0f;
    const d1 = (msg[1] ?? 0) & 0x7f;
    const d2 = (msg[2] ?? 0) & 0x7f;
    if (type !== 0x80 && type !== 0x90 && type !== 0xb0) return;
    spec.controls.forEach((c, i) => {
      if (c.kind !== 'button') return;
      const m = c.midi;
      let on: boolean;
      if (m.type === 'note' && (type === 0x90 || type === 0x80) && m.channel - 1 === ch && m.note === d1) on = type === 0x90 && d2 > 0;
      else if (m.type === 'cc' && type === 0xb0 && m.channel - 1 === ch && m.cc === d1) on = d2 >= 64;
      else return;
      const s = state[i]!;
      s.ledOn = on;
      if (c.mode === 'toggle') s.on = on;
      dirty = true;
    });
    if (type === 0xb0)
      meters.forEach((m, mi) => {
        if (m.midi.channel - 1 !== ch || m.midi.cc !== d1) return;
        lit[mi] = Math.floor((d2 * m.ledCount + 126) / 127);
        dirty = true;
      });
  }

  // UART RX parser (CONTRACTS §2.3): running status on input, real-time bytes ignored, system messages clear running status.
  let rxStatus = 0;
  let rxData: number[] = [];
  function portRxByte(b: number) {
    b &= 0xff;
    if (b >= 0xf8) return;
    if (b & 0x80) {
      rxData = [];
      rxStatus = b >= 0xf0 ? 0 : b;
      return;
    }
    if (!rxStatus) return;
    rxData.push(b);
    const need = (rxStatus & 0xe0) === 0xc0 ? 1 : 2;
    if (rxData.length === need) {
      sendMidi([rxStatus, ...rxData]);
      rxData = [];
    }
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
    sendMidi,
    sendPortMidi(bytes) {
      if (portRx) bytes.forEach(portRxByte);
    },
    onPortMidi(cb) {
      portSubs.add(cb);
      return () => void portSubs.delete(cb);
    },
    onLeds(cb) {
      ledSubs.add(cb);
      return () => void ledSubs.delete(cb);
    },
  };
}
