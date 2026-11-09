import type { AnalogControl, ButtonControl, Control, EncoderControl, Meter } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';
import { keyOf, parse, parsedKey, targetKey } from './bench';
import type { Bench, Parsed } from './bench';

export type Status = 'pass' | 'fail' | 'warn';
export interface Row {
  id: string;
  label: string;
  group?: string;
  kind: Control['kind'] | 'meter' | 'mapping';
  status: Status;
  /** What was tried and what happened, in one line. */
  what: string;
  /** Plain-language next step. */
  fix?: string;
}
export interface Progress {
  done: number;
  total: number;
  current: string;
}
export interface RunOptions {
  noise: number;
  bounce: number;
  onProgress: (p: Progress) => void;
  onRow: (r: Row) => void;
  aborted: () => boolean;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Polls until pred() holds or the time runs out. */
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) return false;
    await sleep(4);
  }
  return true;
}

const TIMEOUT = 900;
const targetText = (c: Control) => (c.midi.type === 'cc' ? `CC ${c.midi.cc}` : noteName(c.midi.note)) + ` ch${c.midi.channel}`;
const pText = (p: Parsed) => (p.type === 'cc' ? `CC ${p.num}` : noteName(p.num)) + ` ch${p.ch}`;

/** LED colour as it comes out of the chain: each channel (c * brightness) >> 8. */
const scaled = (hex: string, brightness: number) =>
  [1, 3, 5].map((i) => (Math.round(parseInt(hex.slice(i, i + 2), 16) * 1) * brightness) >> 8);
export const pixel = (f: Uint8Array | null, i: number) => (f ? [f[i * 3] ?? 0, f[i * 3 + 1] ?? 0, f[i * 3 + 2] ?? 0] : null);
export const lit = (f: Uint8Array | null, i: number, hex: string, brightness: number): boolean | null => {
  const px = pixel(f, i);
  const on = scaled(hex, brightness);
  if (!px || Math.max(...on) < 2) return null; // too dim to tell on from off
  return on.some((v, k) => v >= 2 && px[k]! >= v * 0.5);
};

/** Listens to everything the device sends while a step runs. */
function capture(bench: Bench) {
  const got: Parsed[] = [];
  let hist: Parsed[] = []; // everything from earlier steps of the same control, for cross-talk
  const off = bench.onDevice((m) => {
    const p = parse(m);
    if (p) got.push(p);
  });
  return {
    got,
    stop: off,
    clear: () => (hist.push(...got), (got.length = 0)),
    reset: () => ((hist = []), (got.length = 0)),
    all: () => [...hist, ...got],
  };
}

export async function runAutoTest(bench: Bench, opts: RunOptions): Promise<Row[]> {
  const { spec, sim } = bench;
  const rows: Row[] = [];
  const cap = capture(bench);
  const groupOf = (id: string) => spec.groups?.find((g) => g.members.includes(id))?.label;
  const labels = new Map<string, string>([
    ...spec.controls.map((c) => [targetKey(c.midi), labelOf(c)] as const),
    ...(spec.meters ?? []).map((m) => [keyOf('cc', m.midi.channel, m.midi.cc), `${labelOf(m)} meter (input)`] as const),
  ]);
  const clean = opts.noise === 0 && opts.bounce === 0;
  const brightness = spec.leds?.brightness ?? 255;
  const total = spec.controls.length + (spec.meters?.length ?? 0);
  let done = 0;

  const push = (c: { id: string; label?: string }, kind: Row['kind'], status: Status, what: string, fix?: string) => {
    const r: Row = { id: c.id, label: labelOf(c), group: groupOf(c.id), kind, status, what, fix };
    rows.push(r);
    opts.onRow(r);
  };
  /** Messages in the capture that are not the control's own: its wiring or numbers collide with another control. */
  const strays = (own: string) => {
    if (!clean) return '';
    const other = [...new Set(cap.all().map(parsedKey).filter((k) => k !== own))];
    return other.map((k) => labels.get(k) ?? k.replace(/^(\w+):(\d+):(\d+)$/, '$1 $3 ch$2')).join(', ');
  };
  const crossFix = 'Another control reacted too. Two controls probably share a pin or mux channel; check their wiring rows on the Build page.';

  // ---- mapping conflicts (static) ----
  const byTarget = new Map<string, Control[]>();
  for (const c of spec.controls) byTarget.set(targetKey(c.midi), [...(byTarget.get(targetKey(c.midi)) ?? []), c]);
  for (const list of byTarget.values())
    if (list.length > 1)
      push(
        { id: list[0]!.id, label: list.map(labelOf).join(' + ') },
        'mapping',
        'fail',
        `${list.map(labelOf).join(', ')} ${list.length === 2 ? 'both' : 'all'} send ${targetText(list[0]!)}.`,
        'Your DAW can’t tell these apart. Give each control its own number in the Mapping section of Design.',
      );

  // ---- controls ----
  const analog = async (c: AnalogControl) => {
    const { min, max } = c.midi;
    const key = targetKey(c.midi);
    const want = (x: number) => min + Math.floor((Math.round(x * 4095) * (max - min) + 2047) / 4095);
    const tol = opts.noise > 0 ? 2 + Math.ceil((opts.noise * 127) / 4095) : 1;
    const x0 = bench.value(c.id);
    const seq = x0 <= 0.02 ? [1, 0] : [0, 1, 0];
    const reached: number[] = [];
    let problem = '';
    let silent = false;
    for (const x of seq) {
      cap.clear();
      bench.setAnalog(c.id, x);
      const w = want(x);
      const ok = await until(() => cap.got.some((p) => parsedKey(p) === key && Math.abs(p.value - w) <= tol), TIMEOUT);
      const mine = cap.got.filter((p) => parsedKey(p) === key);
      if (ok) reached.push(w);
      else {
        silent = !mine.length;
        problem = mine.length
          ? `Moved to ${x === 1 ? 'the top' : 'the bottom'} but only reached ${mine.at(-1)!.value} (expected ${w}).`
          : `Nothing arrived when moved to ${x === 1 ? 'the top' : 'the bottom'}.`;
        break;
      }
    }
    const extra = strays(key);
    cap.clear();
    bench.setAnalog(c.id, x0);
    // let the move back arrive now, or it would look like the next control talking
    await until(() => cap.got.some((p) => parsedKey(p) === key && Math.abs(p.value - want(x0)) <= tol), 500);
    await sleep(20);
    if (problem) {
      push(c, c.kind, 'fail', problem, silent ? 'No message at all: check the wiper wire reaches the right pin or mux channel, and that the pot has 3.3 V and ground on its outer legs. A pot with a loose leg reads nothing.' : `The range is cut short. Check the Min and Max in Design (${min}–${max}), or that the pot’s outer legs both go to 3V3 and GND.`);
    } else if (extra) push(c, c.kind, 'fail', `Sent ${targetText(c)} as expected, but also sent ${extra}.`, crossFix);
    else push(c, c.kind, 'pass', `Swept ${seq.join(' → ')} → ${x0.toFixed(2)}: reached ${Math.min(...reached)} and ${Math.max(...reached)} on ${targetText(c)}.`);
  };

  const button = async (c: ButtonControl) => {
    const t = c.midi;
    const key = targetKey(t);
    const isOn = (p: Parsed) => parsedKey(p) === key && (t.type === 'note' ? p.on : p.value === t.max);
    const isOff = (p: Parsed) => parsedKey(p) === key && (t.type === 'note' ? !p.on : p.value === t.min);
    const own = () => cap.got.filter((p) => parsedKey(p) === key);
    const led = c.led && spec.leds ? c.led : null;
    const fail = (what: string, fix: string) => push(c, 'button', 'fail', what, fix);
    const ledLooks = async (expectOn: boolean) => {
      if (!led) return null;
      const ok = await until(() => lit(bench.frame(), led.index, led.color, brightness) === expectOn || lit(bench.frame(), led.index, led.color, brightness) === null, 400);
      return lit(bench.frame(), led.index, led.color, brightness) === null ? null : ok;
    };

    cap.clear();
    sim.setButton(c.id, true);
    const first = await until(() => own().length > 0, TIMEOUT);
    if (!first) {
      sim.setButton(c.id, false);
      return fail('Pressed it and nothing arrived.', 'Check the button’s two legs: one to its pin (or mux channel), the other to GND. On a real build a cold solder joint looks exactly like this.');
    }
    const pressOn = isOn(own()[0]!);
    const ledA = await ledLooks(pressOn);
    cap.clear();
    sim.setButton(c.id, false);
    if (c.mode === 'momentary') {
      const ok = await until(() => own().some(isOff), TIMEOUT);
      const ledB = await ledLooks(false);
      const extra = strays(key);
      if (!pressOn) return fail('Press sent the “off” message instead of “on”.', 'Min and Max look swapped in the Mapping section.');
      if (!ok) return fail('Press worked, but letting go sent nothing.', 'A momentary button should send “off” on release. Switch it to Toggle if you want one message per press, or check debounce isn’t set too high.');
      if (ledA === false || ledB === false) return fail(`The LED ${ledA === false ? 'didn’t light on press' : 'stayed lit after release'}.`, `Check the LED chain: LED #${led!.index} must be wired in the data order, and 5 V and GND must reach it.`);
      if (extra) return push(c, 'button', 'fail', `Sent ${targetText(c)} as expected, but also sent ${extra}.`, crossFix);
      return push(c, 'button', 'pass', `Press → ${pressOn ? 'on' : 'off'}, release → off on ${targetText(c)}${led && ledA !== null ? '; LED followed.' : '.'}`);
    }
    // toggle: releasing sends nothing, the second press flips it
    await sleep(60);
    const onRelease = own().length;
    cap.clear();
    sim.setButton(c.id, true);
    const second = await until(() => own().length > 0, TIMEOUT);
    const flipped = second && isOn(own()[0]!) !== pressOn;
    const ledC = await ledLooks(!pressOn);
    sim.setButton(c.id, false);
    await sleep(40);
    const extra = strays(key);
    if (onRelease) return fail('A toggle button sent a message when released.', 'Toggles should only send on press. Switch the Mode to Momentary, or check for a bouncing switch (raise debounce).');
    if (!flipped) return fail(second ? 'The second press sent the same message again, so it never toggled.' : 'The second press sent nothing.', 'Check debounce: if it’s longer than your finger, presses get swallowed.');
    if (ledA === false || ledC === false) return fail(`The LED didn’t match the state (${ledA === false ? 'first' : 'second'} press).`, `Check the LED chain: LED #${led!.index} must be wired in the data order, and 5 V and GND must reach it.`);
    if (extra) return push(c, 'button', 'fail', `Sent ${targetText(c)} as expected, but also sent ${extra}.`, crossFix);
    push(c, 'button', 'pass', `Press → ${pressOn ? 'on' : 'off'}, press again → ${pressOn ? 'off' : 'on'}, nothing on release, on ${targetText(c)}${led && ledA !== null ? '; LED followed.' : '.'}`);
  };

  const encoder = async (c: EncoderControl) => {
    const t = c.midi;
    const key = targetKey(t);
    const own = () => cap.got.filter((p) => parsedKey(p) === key).map((p) => p.value);
    cap.clear();
    sim.turnEncoder(c.id, 3);
    await until(() => own().length >= 3, TIMEOUT);
    const up = own();
    await sleep(40);
    const extra = strays(key);
    cap.clear();
    sim.turnEncoder(c.id, -3);
    await until(() => own().length >= 3, TIMEOUT);
    const down = own();
    const start = bench.seen.get(key);
    if (!up.length && !down.length) return push(c, 'encoder', 'fail', 'Turned both ways and nothing arrived.', 'Check A and B go to two separate pins and the middle leg goes to GND.');
    if (c.relative) {
      const okUp = up.length >= 3 && up.every((v) => v === 65);
      const okDown = down.length >= 3 && down.every((v) => v === 63);
      if (okUp && okDown) return push(c, 'encoder', extra ? 'fail' : 'pass', extra ? `Right on ${targetText(c)}, but also sent ${extra}.` : `3 clicks right → 65 ×3, 3 clicks left → 63 ×3 (relative) on ${targetText(c)}.`, extra ? crossFix : undefined);
      if (up.length >= 3 && up.every((v) => v === 63) && down.every((v) => v === 65)) return push(c, 'encoder', 'fail', 'It counts backwards: clockwise sent 63.', 'Swap the A and B wires.');
      return push(c, 'encoder', 'fail', `Expected 3 clicks each way, got ${up.length} right and ${down.length} left.`, 'Dirty or loose contacts miss clicks. Re-seat the encoder, and check its middle leg is on GND.');
    }
    // absolute: starts at min, clamps at both ends
    const atMax = start !== undefined && start >= t.max;
    const rising = up.length >= 2 && up.at(-1)! > up[0]!;
    const falling = down.length >= 2 && down.at(-1)! < down[0]!;
    if ((rising || atMax) && falling) return push(c, 'encoder', extra ? 'fail' : 'pass', extra ? `Counts right on ${targetText(c)}, but also sent ${extra}.` : `Right counted up, left counted down on ${targetText(c)} (${[...up, ...down].join(', ')}).`, extra ? crossFix : undefined);
    if (!up.length && down.length >= 2 && down.at(-1)! > down[0]!) return push(c, 'encoder', 'fail', 'It counts backwards.', 'Swap the A and B wires.');
    push(c, 'encoder', 'fail', `Expected the value to rise on the right and fall on the left, got ${up.join(', ') || 'nothing'} then ${down.join(', ') || 'nothing'}.`, 'Re-seat the encoder, and check A, B and the middle leg (GND).');
  };

  const meter = async (m: Meter) => {
    const f = () => bench.frame();
    const segs = () => Array.from({ length: m.ledCount }, (_, i) => {
      const p = pixel(f(), m.ledStart + i);
      return !!p && p[0]! + p[1]! + p[2]! > 0;
    });
    const send = (v: number) => sim.sendMidi([0xb0 | (m.midi.channel - 1), m.midi.cc, v]);
    const exp = (v: number) => Math.floor((v * m.ledCount + 126) / 127);
    const problems: string[] = [];
    for (const v of [127, 0, 64]) {
      send(v);
      const n = exp(v);
      const ok = await until(() => {
        const s = segs();
        return s.filter(Boolean).length === n && s.every((x, i) => x === i < n);
      }, TIMEOUT);
      if (!ok) problems.push(`CC ${v} should light ${n} of ${m.ledCount} segments, but ${segs().filter(Boolean).length} lit`);
    }
    send(0);
    if (!problems.length) return push(m, 'meter', 'pass', `CC ${m.midi.cc} ch${m.midi.channel}: full, empty and half levels lit ${m.ledCount}, 0 and ${exp(64)} segments from the bottom.`);
    push(m, 'meter', 'fail', problems.join('; ') + '.', bench.frame() ? 'The LED range may overlap another item, or the data line is broken partway. Check the LED order on the Build page.' : 'The LED chain never refreshed. Check the LED data pin and count.');
  };

  try {
    for (const c of spec.controls) {
      if (opts.aborted()) break;
      cap.reset();
      opts.onProgress({ done, total, current: labelOf(c) });
      if (c.kind === 'button') await button(c);
      else if (c.kind === 'encoder') await encoder(c);
      else await analog(c);
      done++;
    }
    for (const m of spec.meters ?? []) {
      if (opts.aborted()) break;
      opts.onProgress({ done, total, current: `${labelOf(m)} meter` });
      if (spec.leds) await meter(m);
      else push(m, 'meter', 'fail', 'There is no LED chain to light this meter.', 'Add an LED chain in Design.');
      done++;
    }
  } finally {
    cap.stop();
  }
  opts.onProgress({ done, total, current: '' });
  return rows;
}
