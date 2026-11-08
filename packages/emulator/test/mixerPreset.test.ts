// The shipped Portable Mixer 6 preset through the model and the real firmware: MIDI, UART mirror and settled LED frames must match.
import { expect, test } from 'bun:test';
import { allocatePins, createModelDevice, EXAMPLES, validate } from '@kontrolla/core';
import type { ButtonControl, DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';
import { createRp2040Device } from '../src';
import { firmware } from './helpers';

const spec: DeviceSpec = allocatePins(EXAMPLES['mixer-6ch']!);
const btn = (id: string) => spec.controls.find((c) => c.id === id) as ButtonControl;
/** UART bytes that switch a button's LED/toggle state, with running status for the second message. */
const noteBytes = (a: string, onA: boolean, b: string, onB: boolean) => {
  const [x, y] = [btn(a).midi, btn(b).midi];
  if (x.type !== 'note' || y.type !== 'note') throw new Error('note targets expected');
  return [0x90 | (x.channel - 1), x.note, onA ? 127 : 0, ...(x.channel === y.channel ? [] : [0x90 | (y.channel - 1)]), y.note, onB ? 127 : 0];
};

async function run(d: DeviceSim) {
  const midi: number[][] = [];
  const port: number[][] = [];
  const frames: string[] = [];
  let last = '';
  d.onMidi((m) => midi.push(m));
  d.onPortMidi!((m) => port.push(m));
  d.onLeds((rgb) => (last = [...rgb].join(',')));
  const settle = async (ms = 40) => (await d.advance(ms), frames.push(last));
  const analog = spec.controls.filter((c) => c.kind === 'pot' || c.kind === 'fader').map((c) => c.id);
  analog.forEach((id, i) => d.setAnalog(id, ((i * 37) % 90) / 100 + 0.05)); // power-on baseline for all 59
  await settle();
  // sweeps on three strips and the master section
  for (const id of ['ch1-gain', 'ch1-fader', 'ch2-hi', 'ch2-fader', 'ch3-pan', 'ch3-fader', 'booth'])
    for (const x of [0.9, 0.2, 0.55, 1, 0]) (d.setAnalog(id, x), await d.advance(12));
  await settle();
  // presses: toggles (mute/solo/cue/input on three strips), momentary tap + encoder push
  for (const id of ['ch1-mute', 'ch2-solo', 'ch3-cue', 'ch1-input', 'tap', 'fx-select-push', 'ch1-mute', 'ch2-solo']) {
    d.setButton(id, true);
    await d.advance(12);
    d.setButton(id, false);
    await d.advance(12);
  }
  d.turnEncoder('fx-select', 3);
  await d.advance(60);
  d.turnEncoder('fx-select', -2);
  await settle(60);
  // DAW feedback over the UART with running status: toggle states, then every strip's meter
  d.sendPortMidi!(noteBytes('ch2-mute', true, 'ch3-mute', true));
  await settle(30);
  d.sendPortMidi!(noteBytes('ch1-solo', true, 'ch1-cue', true));
  await settle(30);
  const meters = spec.meters!.filter((m) => m.midi.channel === 1);
  d.sendPortMidi!([0xb0, ...meters.flatMap((m, i) => [m.midi.cc, [0, 20, 64, 90, 110, 127, 127, 3][i % 8]!])]); // one status byte, running status for the rest
  await settle(40);
  d.sendPortMidi!([0xb0, ...meters.flatMap((m, i) => [m.midi.cc, [127, 100, 64, 30, 10, 0, 1, 50][i % 8]!])]);
  await settle(40);
  // a press after the DAW set the toggle flips from the DAW's state (ch2-mute is on)
  d.setButton('ch2-mute', true);
  await d.advance(12);
  d.setButton('ch2-mute', false);
  await settle(40);
  return { midi, port, frames };
}

const same = async (opts?: SimOptions) => {
  const model = await run(createModelDevice(spec, opts));
  const fw = await run(await createRp2040Device(spec, firmware, opts));
  expect(model.midi.length).toBeGreaterThan(30);
  expect(fw.midi).toEqual(model.midi);
  expect(fw.port).toEqual(fw.midi);
  expect(model.port).toEqual(model.midi);
  expect(fw.frames).toEqual(model.frames);
  expect(new Set(fw.frames).size).toBeGreaterThan(5);
};

test('mixer-6ch preset validates without errors and fits the scan period', () => {
  const issues = validate(spec);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(issues.filter((i) => /Scan needs/.test(i.message) && i.severity !== 'info')).toEqual([]);
});

test('mixer-6ch preset: firmware == model (noise off)', () => same());

// Mux controls are sampled in bus-major order by both implementations, so even the seeded noise stream lines up.
test('mixer-6ch preset: firmware == model with ADC noise and contact bounce', () => same({ analogNoiseLsb: 12, buttonBounceMs: 2, seed: 7 }));

test('mixer-6ch preset: perf', async () => {
  const d = await createRp2040Device(spec, firmware);
  d.sendPortMidi!([0xb0, 21, 100]);
  const t = performance.now();
  await d.advance(2000);
  console.log(`mixer-6ch preset: ${(2000 / (performance.now() - t)).toFixed(2)} sim-ms per wall-ms`);
});
