// Contract v2 differential: shared select bus (2 analog + 1 digital mux), illuminated toggle/momentary buttons on the
// digital mux, meters, host MIDI feedback. MIDI sequences and the settled LED frame after every phase must match.
import { expect, test } from 'bun:test';
import { createModelDevice } from '@kontrolla/core';
import type { DeviceSim } from '@kontrolla/core';
import { createRp2040Device } from '../src';
import { firmware } from './helpers';
import { mixer } from './mixerSpec';

async function run(d: DeviceSim) {
  const midi: number[][] = [];
  const frames: string[] = []; // settled frame after each phase
  let last = '';
  d.onMidi((m) => midi.push(m));
  d.onLeds((rgb) => (last = [...rgb].join(',')));
  const phase = async (ms = 60) => (await d.advance(ms), frames.push(last));
  for (const id of ['a0', 'a1', 'b0', 'b1']) d.setAnalog(id, 0.3); // power-on baseline
  await phase();
  for (const id of ['a0', 'a1', 'b0', 'b1']) (d.setAnalog(id, 0.9), await d.advance(30));
  await phase();
  // local presses: toggle, momentary, CC target, plain
  for (const id of ['mute', 'cue', 'rec', 'plain', 'mute']) {
    d.setButton(id, true);
    await d.advance(15);
    frames.push(last);
    d.setButton(id, false);
    await d.advance(15);
  }
  await phase();
  // DAW feedback: note on/off, vel 0, CC >=64 / <64, toggle state follows the DAW
  const fb = [[0x90, 11, 127], [0x90, 10, 1], [0x90, 12, 100], [0x80, 12, 0], [0x90, 10, 0], [0xb0, 20, 64], [0xb0, 20, 63], [0xb0, 20, 127]];
  for (const m of fb) (d.sendMidi(m), await d.advance(25), frames.push(last));
  d.setButton('solo', true); // DAW said solo is on, so this press turns it off
  await d.advance(15);
  d.setButton('solo', false);
  await phase();
  // meters: every segment boundary incl. 0, 1, 127 and an off-channel message that must be ignored
  for (const v of [0, 1, 13, 64, 90, 100, 127, 5]) (d.sendMidi([0xb0, 30, v]), d.sendMidi([0xb0, 31, 127 - v]), await d.advance(25), frames.push(last));
  d.sendMidi([0xb1, 30, 127]);
  await phase();
  return { midi, frames };
}

test('mixer: firmware == model (MIDI, settled LED frames)', async () => {
  const model = await run(createModelDevice(mixer));
  const fw = await run(await createRp2040Device(mixer, firmware));
  expect(model.midi.length).toBeGreaterThan(15);
  expect(model.frames.at(-1)!.length).toBeGreaterThan(0);
  expect(fw.frames.at(-1)!.length).toBeGreaterThan(0); // LEDs really came out of the PIO waveform
  expect(new Set(fw.frames).size).toBeGreaterThan(10);
  expect(fw.midi).toEqual(model.midi);
  expect(fw.frames).toEqual(model.frames);
});

test('mixer: perf', async () => {
  const d = await createRp2040Device(mixer, firmware);
  d.sendMidi([0xb0, 30, 100]);
  const t = performance.now();
  await d.advance(2000);
  console.log(`mixer: ${(2000 / (performance.now() - t)).toFixed(2)} sim-ms per wall-ms`);
});
