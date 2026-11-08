import type { AnalogControl, ButtonControl, Meter } from '@kontrolla/core';
import { keyOf, parse, targetKey, targetMsg } from './bench';
import type { Bench } from './bench';

export interface DawOptions {
  /** Send moving level CCs to every meter. */
  play: boolean;
  /** Mirror mute/solo/cue presses back to the device, like a DAW that owns the real state. */
  echo: boolean;
  /** With echo: turning one solo on switches the other solos off. */
  exclusive: boolean;
}

const TICK_MS = 50;
const ECHO_DELAY_MS = 120; // a believable round trip, so cause and effect are visible
const UNITY = 0.8;
const wave = (t: number, f: number, p: number) => Math.sin(2 * Math.PI * f * t + p);

/** Fake "music": a slow swell, a faster wobble and a beat, different for every meter. */
const signal = (t: number, i: number): number => {
  const swell = 0.5 + 0.26 * wave(t, 0.23 + 0.07 * i, i * 1.7) + 0.14 * wave(t, 1.1 + 0.19 * i, i * 0.9);
  const beat = Math.max(0, wave(t, 2, i * 0.6)) ** 4 * 0.16;
  return Math.min(1, Math.max(0.04, swell + beat));
};

/**
 * A pretend DAW on the other end of the cable. It watches what the device sends (so it knows each mute and fader),
 * feeds the meters, and optionally answers button presses. Everything it sends goes through DeviceSim.sendMidi.
 */
export function createDaw(bench: Bench, log: (msg: number[]) => void) {
  const { spec, sim } = bench;
  const buttons = spec.controls.filter((c): c is ButtonControl => c.kind === 'button');
  const meters = spec.meters ?? [];
  const on = new Map<string, boolean>(); // the DAW's own idea of each button
  const lastCc = new Map<string, number>();
  const sent = new Map<string, number>();
  const level = new Map<string, number>(); // post-mute level per meter, for the master bus
  const opts: DawOptions = { play: false, echo: false, exclusive: false };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let ticker: ReturnType<typeof setInterval> | undefined;
  let t0 = performance.now();
  let count = 0;

  const send = (msg: number[], quiet = false) => {
    sim.sendMidi(msg);
    count++;
    if (!quiet) log(msg);
  };

  const ctx = (m: Meter) => {
    const g = spec.groups?.find((x) => x.members.includes(m.id));
    const mine = (g?.members ?? []).map((id) => spec.controls.find((c) => c.id === id));
    return {
      section: g?.kind === 'section',
      fader: mine.find((c): c is AnalogControl => c?.kind === 'fader'),
      mute: mine.find((c): c is ButtonControl => c?.kind === 'button' && /mute/i.test(c.label ?? c.id)),
    };
  };
  const gainOf = (f: AnalogControl | undefined) => {
    if (!f) return 1;
    const v = lastCc.get(targetKey(f.midi));
    return v === undefined ? bench.value(f.id) : (v - f.midi.min) / Math.max(1, f.midi.max - f.midi.min);
  };

  const pushLevel = (m: Meter, lvl: number) => {
    const v = Math.round(Math.min(1, Math.max(0, lvl)) * 127);
    const key = keyOf('cc', m.midi.channel, m.midi.cc);
    if (sent.get(key) === v) return;
    sent.set(key, v);
    send([0xb0 | (m.midi.channel - 1), m.midi.cc, v], true);
  };

  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    const strips: number[] = [];
    meters.forEach((m, i) => {
      const c = ctx(m);
      if (c.section) return;
      const lvl = c.mute && on.get(c.mute.id) ? 0 : signal(t, i) * gainOf(c.fader) * (c.fader ? 1 : UNITY);
      level.set(m.id, lvl);
      strips.push(lvl);
      pushLevel(m, lvl);
    });
    // master meters: the sum of the strips (softened), through the master fader, a touch different left/right
    const bus = strips.length ? Math.min(1, (strips.reduce((a, b) => a + b, 0) / strips.length) * 1.5) : 0;
    meters.forEach((m, i) => {
      const c = ctx(m);
      if (!c.section) return;
      const side = 0.92 + 0.08 * wave(t, 3.1, i);
      pushLevel(m, (strips.length ? bus : signal(t, i)) * gainOf(c.fader) * side);
    });
  };

  const echoBack = (b: ButtonControl, state: boolean) => {
    const id = setTimeout(() => (timers.delete(id), send(targetMsg(b.midi, state))), ECHO_DELAY_MS);
    timers.add(id);
  };

  const off = bench.onDevice((msg) => {
    const p = parse(msg);
    if (!p) return;
    if (p.type === 'cc') lastCc.set(keyOf('cc', p.ch, p.num), p.value);
    for (const b of buttons) {
      if (targetKey(b.midi) !== keyOf(p.type, p.ch, p.num)) continue;
      const wasOn = on.get(b.id) ?? false;
      // a toggle button reports its own state; a momentary one is latched by the DAW (press = flip) when echoing
      if (b.mode === 'momentary' && opts.echo && !p.on) continue;
      const next = b.mode === 'toggle' ? p.on : opts.echo ? !wasOn : p.on;
      on.set(b.id, next);
      if (!opts.echo) continue;
      echoBack(b, next);
      if (opts.exclusive && next && /solo/i.test(b.label ?? b.id))
        for (const o of buttons)
          if (o !== b && /solo/i.test(o.label ?? o.id) && on.get(o.id)) (on.set(o.id, false), echoBack(o, false));
    }
  });

  const silence = () => {
    for (const m of meters) pushLevel(m, 0);
    sent.clear();
  };

  return {
    /** Level CCs sent so far (for a messages-per-second readout). */
    sent: () => count,
    set(next: Partial<DawOptions>) {
      const was = opts.play;
      Object.assign(opts, next);
      if (opts.play && !was) {
        t0 = performance.now();
        ticker = setInterval(tick, TICK_MS);
      } else if (!opts.play && was) {
        clearInterval(ticker);
        silence();
      }
    },
    dispose() {
      off();
      clearInterval(ticker);
      timers.forEach(clearTimeout);
    },
  };
}

export type Daw = ReturnType<typeof createDaw>;
