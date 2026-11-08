// Contract v3 differential: mux enable sharing, UART MIDI mirror, UART running-status input.
import { expect, test } from 'bun:test';
import { createModelDevice, validate } from '@kontrolla/core';
import type { DeviceSim } from '@kontrolla/core';
import { createRp2040Device } from '../src';
import { firmware } from './helpers';
import { mixer3 } from './mixer3Spec';

async function run(d: DeviceSim) {
  const midi: number[][] = [];
  const port: number[][] = [];
  const frames: string[] = [];
  let last = '';
  d.onMidi((m) => midi.push(m));
  d.onPortMidi!((m) => port.push(m));
  d.onLeds((rgb) => (last = [...rgb].join(',')));
  const step = async (ms = 40) => (await d.advance(ms), frames.push(last));
  const pots = ['a0', 'b0', 'c0', 'd0', 'c5', 'd5'];
  pots.forEach((id, i) => d.setAnalog(id, 0.2 + i * 0.1)); // power-on baseline (distinct per pot: a mux mix-up would show)
  await step();
  for (const id of pots) (d.setAnalog(id, 0.95), await d.advance(30));
  await step();
  for (const id of pots) (d.setAnalog(id, 0.05), await d.advance(30));
  await step();
  for (const id of ['mute', 'solo', 'cue', 'rec', 'mute', 'solo']) {
    d.setButton(id, true);
    await d.advance(15);
    frames.push(last);
    d.setButton(id, false);
    await d.advance(15);
  }
  await step();
  // USB feedback
  for (const m of [[0x90, 11, 127], [0xb0, 20, 100], [0xb0, 30, 90]]) (d.sendMidi(m), await d.advance(25), frames.push(last));
  // UART feedback with running status: note on mute, running-status note 11 vel 0, a real-time byte inside a message,
  // meter levels (second message via running status), then a SysEx whose data bytes must be ignored.
  d.sendPortMidi!([0x90, 10, 127, 11, 0]);
  await step(30);
  d.sendPortMidi!([0xb0, 30, 100, 0xf8, 31, 20]);
  await step(30);
  d.sendPortMidi!([0xf0, 0x7e, 0x7f, 0xf7, 30, 1]); // after SysEx there is no running status: "30, 1" is dropped
  await step(30);
  d.sendPortMidi!([0xb0, 30]); // incomplete, then a new status abandons it
  d.sendPortMidi!([0xb0, 31, 127]);
  await step(30);
  // a press after the DAW set the toggle: flips from the DAW state (mute is on from the UART note)
  d.setButton('mute', true);
  await d.advance(15);
  d.setButton('mute', false);
  await step();
  return { midi, port, frames };
}

test('mixer3: firmware == model (USB MIDI, UART mirror, LEDs); UART mirrors USB exactly', async () => {
  expect(validate(mixer3).filter((i) => i.severity === 'error')).toEqual([]);
  const model = await run(createModelDevice(mixer3));
  const fw = await run(await createRp2040Device(mixer3, firmware));
  expect(model.midi.length).toBeGreaterThan(25);
  expect(model.port).toEqual(model.midi);
  expect(fw.midi).toEqual(model.midi);
  expect(fw.port).toEqual(fw.midi);
  expect(fw.frames).toEqual(model.frames);
  expect(new Set(fw.frames).size).toBeGreaterThan(10);
  // each pot actually reached its own CC (a shared-ADC mix-up would fall short)
  const ccs = new Set(fw.midi.filter((m) => m[0] === 0xb0 && m[1]! <= 6).map((m) => m[1]));
  expect([...ccs].sort()).toEqual([1, 2, 3, 4, 5, 6]);
});

test('59 analog controls on 4 muxes (two share ADC2): all read, still real-time', async () => {
  const { big59 } = await import('./bigSpec');
  expect(validate(big59).filter((i) => i.severity === 'error')).toEqual([]);
  const d = await createRp2040Device(big59, firmware);
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  for (let i = 0; i < 59; i++) d.setAnalog(`p${i}`, 0.1);
  await d.advance(20);
  for (let i = 0; i < 59; i++) d.setAnalog(`p${i}`, 0.9);
  const t = performance.now();
  await d.advance(100);
  console.log(`59 analog: ${(100 / (performance.now() - t)).toFixed(2)} sim-ms per wall-ms`);
  // every pot answered within the 100 ms: one scan stays below 1 ms
  expect(new Set(out.map((m) => m[1])).size).toBe(59);
  const t2 = performance.now();
  await d.advance(1900);
  console.log(`59 analog steady state: ${(1900 / (performance.now() - t2)).toFixed(2)} sim-ms per wall-ms`);
});
