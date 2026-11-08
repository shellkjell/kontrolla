import { expect, test } from 'bun:test';
import { createModelDevice } from '../src';
import type { AnalogControl, Control, DeviceSpec, Mux } from '../src';

const mk = (controls: Control[], muxes: Mux[] = []): DeviceSpec => ({
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 't', muxes, controls,
});
const pot = (id: string, over: Partial<AnalogControl> = {}): Control => ({
  id, kind: 'pot', part: 'pot-b10k', pin: 26, midi: { type: 'cc', channel: 1, cc: 7, min: 0, max: 127 },
  deadband: 8, smoothing: 0, ...over,
});
const btn = (mode: 'momentary' | 'toggle'): Control => ({
  id: 'b', kind: 'button', part: 'button-tact-6mm', pin: 5, mode, debounceMs: 5,
  midi: { type: 'note', channel: 2, note: 60, velocity: 100 },
});
const enc = (relative: boolean): Control => ({
  id: 'e', kind: 'encoder', part: 'encoder-ec11', pinA: 6, pinB: 7, relative,
  midi: { type: 'cc', channel: 1, cc: 10, min: 0, max: 127 },
});
const rec = (d: ReturnType<typeof createModelDevice>) => {
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  return out;
};

test('pot sweep emits monotonic CCs ending at 127', async () => {
  const d = createModelDevice(mk([pot('p')]));
  const out = rec(d);
  await d.advance(3);
  for (let i = 0; i <= 100; i++) (d.setAnalog('p', i / 100), await d.advance(2));
  const vals = out.map((m) => m[2]!);
  expect(vals.length).toBeGreaterThan(10);
  expect(vals).toEqual([...vals].sort((a, b) => a - b));
  expect(vals.at(-1)).toBe(127);
  expect(out[0]![0]).toBe(0xb0);
});

test('deadband suppresses noise', async () => {
  const d = createModelDevice(mk([pot('p', { deadband: 16 })]), { analogNoiseLsb: 3, seed: 5 });
  const out = rec(d);
  d.setAnalog('p', 0.5);
  await d.advance(500);
  expect(out).toEqual([]);
});

test('button debounce with bounce, momentary', async () => {
  const d = createModelDevice(mk([btn('momentary')]), { buttonBounceMs: 3, seed: 9 });
  const out = rec(d);
  d.setButton('b', true);
  await d.advance(30);
  d.setButton('b', false);
  await d.advance(30);
  expect(out).toEqual([[0x91, 60, 100], [0x81, 60, 0]]);
});

test('toggle mode', async () => {
  const d = createModelDevice(mk([btn('toggle')]));
  const out = rec(d);
  for (let i = 0; i < 3; i++) {
    d.setButton('b', true);
    await d.advance(20);
    d.setButton('b', false);
    await d.advance(20);
  }
  expect(out).toEqual([[0x91, 60, 100], [0x81, 60, 0], [0x91, 60, 100]]);
});

test('encoder absolute clamps', async () => {
  const d = createModelDevice(mk([enc(false)]));
  const out = rec(d);
  d.turnEncoder('e', 3);
  await d.advance(60);
  d.turnEncoder('e', -5);
  await d.advance(100);
  expect(out.map((m) => m[2])).toEqual([1, 2, 3, 2, 1, 0]);
});

test('encoder relative 65/63', async () => {
  const d = createModelDevice(mk([enc(true)]));
  const out = rec(d);
  d.turnEncoder('e', 2);
  await d.advance(40);
  d.turnEncoder('e', -1);
  await d.advance(40);
  expect(out.map((m) => m[2])).toEqual([65, 65, 63]);
});

test('mux pot', async () => {
  const mux: Mux = { id: 'm', part: 'mux-74hc4067', sigPin: 26, selectPins: [2, 3, 4, 5], signal: 'analog' };
  const a = pot('a', { pin: undefined, mux: { id: 'm', channel: 3 } });
  const b = pot('b', { pin: undefined, mux: { id: 'm', channel: 7 }, midi: { type: 'cc', channel: 1, cc: 9, min: 0, max: 127 } });
  const d = createModelDevice(mk([a, b], [mux]));
  const out = rec(d);
  await d.advance(3);
  d.setAnalog('b', 1);
  await d.advance(3);
  expect(out).toEqual([[0xb0, 9, 127]]);
});
