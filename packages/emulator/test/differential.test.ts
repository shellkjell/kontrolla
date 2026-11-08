// Same scripted stimulus through the behavioural model and the real firmware; MIDI sequences must match (CONTRACTS §2).
import { expect, test } from 'bun:test';
import { allocatePins, createModelDevice, EXAMPLES } from '@kontrolla/core';
import type { Control, DeviceSim, DeviceSpec } from '@kontrolla/core';
import { createRp2040Device } from '../src';
import { firmware } from './helpers';

async function script(spec: DeviceSpec, d: DeviceSim): Promise<number[][]> {
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  await d.advance(5);
  const pots = spec.controls.filter((c) => c.kind === 'pot' || c.kind === 'fader');
  const sweep = [0, 0.1, 0.3, 0.5, 0.52, 0.8, 1, 0.4, 0.4, 0];
  for (const c of pots)
    for (const x of sweep) {
      d.setAnalog(c.id, x);
      await d.advance(40);
    }
  for (const c of spec.controls.filter((c) => c.kind === 'button'))
    for (let i = 0; i < 3; i++) {
      d.setButton(c.id, true);
      await d.advance(20);
      d.setButton(c.id, false);
      await d.advance(20);
    }
  for (const c of spec.controls.filter((c) => c.kind === 'encoder'))
    for (const n of [3, -2, 1, -5, 140]) {
      d.turnEncoder(c.id, n);
      await d.advance(Math.abs(n) * 8 + 20);
    }
  return out;
}

async function same(spec: DeviceSpec) {
  const model = await script(spec, createModelDevice(spec));
  const fw = await script(spec, await createRp2040Device(spec, firmware));
  expect(model.length).toBeGreaterThan(20);
  expect(fw).toEqual(model);
}

test('starter', () => same(allocatePins(EXAMPLES.starter!)));
test('big-knobs', () => same(allocatePins(EXAMPLES['big-knobs']!)));

test('mux pots, toggle button, CC button, relative + absolute encoders', () => {
  const cc = (n: number, min = 0, max = 127) => ({ type: 'cc' as const, channel: 3, cc: n, min, max });
  const controls: Control[] = [
    { id: 'm0', kind: 'pot', part: 'pot-b10k', mux: { id: 'mx', channel: 0 }, midi: cc(1), deadband: 0, smoothing: 0 },
    { id: 'm5', kind: 'fader', part: 'fader-60mm', mux: { id: 'mx', channel: 5 }, midi: cc(2, 10, 100), deadband: 4, smoothing: 128 },
    { id: 'p', kind: 'pot', part: 'pot-b10k', pin: 27, midi: cc(3, 127, 0), deadband: 0, smoothing: 200 },
    { id: 'tog', kind: 'button', part: 'button-tact-6mm', pin: 10, mode: 'toggle', debounceMs: 3, midi: { type: 'note', channel: 2, note: 61, velocity: 90 } },
    { id: 'ccb', kind: 'button', part: 'button-tact-6mm', pin: 11, mode: 'momentary', debounceMs: 0, midi: cc(9, 5, 99) },
    { id: 'ea', kind: 'encoder', part: 'encoder-ec11', pinA: 12, pinB: 13, relative: false, midi: cc(10, 20, 30) },
    { id: 'er', kind: 'encoder', part: 'encoder-ec11', pinA: 14, pinB: 15, relative: true, midi: cc(11) },
  ];
  return same({
    version: 1, name: 'mix', mcu: 'rp2040-pico', usbProductName: 'mix', controls,
    muxes: [{ id: 'mx', part: 'mux-74hc4067', sigPin: 26, selectPins: [2, 3, 4, 5] }],
  });
});

test('perf: simulated ms per wall ms', async () => {
  const spec = allocatePins(EXAMPLES['big-knobs']!);
  const d = await createRp2040Device(spec, firmware);
  const t = performance.now();
  await d.advance(2000);
  const rate = 2000 / (performance.now() - t);
  console.log(`big-knobs: ${rate.toFixed(2)} sim-ms per wall-ms`);
  expect(rate).toBeGreaterThan(0);
});
