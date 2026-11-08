// Snapshot request (CONTRACTS §2.5), model only: coalescing, timing, first-scan behaviour. Firmware equality: emulator/test/snapshot.test.ts.
import { expect, test } from 'bun:test';
import { createModelDevice } from '../src';
import type { DeviceSpec } from '../src';

const spec: DeviceSpec = {
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 't', muxes: [],
  controls: [
    { id: 'p', kind: 'pot', part: 'pot-b10k', pin: 26, midi: { type: 'cc', channel: 1, cc: 7, min: 0, max: 127 }, deadband: 8, smoothing: 0 },
    { id: 't', kind: 'button', part: 'button-tact-6mm', pin: 10, mode: 'toggle', debounceMs: 0, midi: { type: 'note', channel: 1, note: 60, velocity: 100 } },
  ],
};
const REQ = [0xf0, 0x7d, 0x6b, 0x01, 0xf7];

test('request is served at the end of the next scan, repeats coalesce, junk is ignored', async () => {
  const d = createModelDevice(spec);
  const out: [number[], number][] = [];
  d.onMidi((m, t) => out.push([m, t]));
  d.setAnalog('p', 1);
  await d.advance(3); // baseline, nothing sent
  expect(out).toEqual([]);
  d.sendMidi(REQ);
  d.sendMidi(REQ);
  d.sendMidi([0xf0, 0x7d, 0x6b, 0x02, 0xf7]);
  d.sendMidi([0xf0, 0x7d, 0x6b, 0x01, 0xf7, 0xf7]); // trailing F7 without F0 is ignored; the request itself still counts
  expect(out).toEqual([]);
  await d.advance(1);
  expect(out).toEqual([[[0xb0, 7, 127], 3], [[0x80, 60, 0], 3]]); // pot value, toggle OFF
  await d.advance(5);
  expect(out.length).toBe(2);
});

test('request before the first scan: served after the baseline scan', async () => {
  const d = createModelDevice(spec);
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  d.setAnalog('p', 0.5);
  d.sendMidi(REQ);
  await d.advance(1);
  expect(out).toEqual([[0xb0, 7, 64], [0x80, 60, 0]]);
});

test('snapshot updates the deadband reference so the next move is not a duplicate', async () => {
  const d = createModelDevice(spec);
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  d.setAnalog('p', 0.5);
  await d.advance(2);
  d.setAnalog('p', 0.51); // inside the deadband, mapped value changes 64 -> 65 unsent
  await d.advance(2);
  d.sendMidi(REQ);
  await d.advance(2);
  expect(out[0]).toEqual([0xb0, 7, 65]);
  out.length = 0;
  d.setAnalog('p', 0.512);
  await d.advance(5);
  expect(out).toEqual([]);
});

test('SysEx over the UART: split by real-time bytes works, a status byte inside aborts, no RX pin = ignored', async () => {
  const withPort: DeviceSpec = { ...spec, midiPort: { part: 'midi-trs-a', txPin: 0, rxPin: 1 } };
  const d = createModelDevice(withPort);
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  await d.advance(2);
  d.sendPortMidi!([0xf0, 0x7d, 0xf8, 0x6b, 0x01, 0xfe, 0xf7]);
  await d.advance(2);
  expect(out.length).toBe(2);
  out.length = 0;
  d.sendPortMidi!([0xf0, 0x7d, 0x6b, 0x01, 0xb0, 7, 1, 0xf7]); // CC inside: abandons the SysEx
  await d.advance(2);
  expect(out).toEqual([]);
  const tx = createModelDevice({ ...spec, midiPort: { part: 'midi-trs-a', txPin: 0 } });
  const o2: number[][] = [];
  tx.onMidi((m) => o2.push(m));
  await tx.advance(2);
  tx.sendPortMidi!(REQ);
  await tx.advance(2);
  expect(o2).toEqual([]);
});
