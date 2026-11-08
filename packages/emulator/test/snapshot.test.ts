// Snapshot request (CONTRACTS §2.5): F0 7D 6B 01 F7 over USB or UART -> current state of every control, in record order.
import { expect, test } from 'bun:test';
import { allocatePins, createModelDevice, EXAMPLES } from '@kontrolla/core';
import type { Control, DeviceSim, DeviceSpec } from '@kontrolla/core';
import { createRp2040Device } from '../src';
import { firmware } from './helpers';

const REQ = [0xf0, 0x7d, 0x6b, 0x01, 0xf7];
const cc = (n: number, min = 0, max = 127) => ({ type: 'cc' as const, channel: 2, cc: n, min, max });
const note = (n: number) => ({ type: 'note' as const, channel: 1, note: n, velocity: 100 });
const controls: Control[] = [
  { id: 'p1', kind: 'pot', part: 'pot-b10k', pin: 26, midi: cc(1), deadband: 30, smoothing: 0 }, // wide deadband: drift stays unsent
  { id: 'p2', kind: 'pot', part: 'pot-b10k', pin: 27, midi: cc(2, 20, 100), deadband: 8, smoothing: 0 },
  { id: 'tn', kind: 'button', part: 'button-tact-6mm', pin: 10, mode: 'toggle', debounceMs: 3, midi: note(40) },
  { id: 'tc', kind: 'button', part: 'button-tact-6mm', pin: 11, mode: 'toggle', debounceMs: 3, midi: cc(50, 5, 99) },
  { id: 'mo', kind: 'button', part: 'button-tact-6mm', pin: 12, mode: 'momentary', debounceMs: 3, midi: note(41) },
  { id: 'ea', kind: 'encoder', part: 'encoder-ec11', pinA: 14, pinB: 15, relative: false, midi: cc(60, 10, 20) },
  { id: 'er', kind: 'encoder', part: 'encoder-ec11', pinA: 16, pinB: 17, relative: true, midi: cc(61) },
];
const small: DeviceSpec = {
  version: 1, name: 'snap', mcu: 'rp2040-pico', usbProductName: 'snap', muxes: [], controls,
  midiPort: { part: 'midi-trs-a', txPin: 0, rxPin: 1 },
};

async function script(d: DeviceSim, bootRequest: boolean) {
  const usb: number[][] = [];
  const port: number[][] = [];
  d.onMidi((m) => usb.push(m));
  d.onPortMidi!((m) => port.push(m));
  const mark: number[] = [];
  const burst = async (send: () => void, ms = 15) => {
    mark.push(usb.length);
    send();
    await d.advance(ms);
    mark.push(usb.length);
  };
  d.setAnalog('p1', 0.5);
  d.setAnalog('p2', 0.25);
  if (bootRequest) await burst(() => d.sendMidi(REQ), 10); // before the first scan: served right after the baseline scan
  await d.advance(10);
  // reach a state: tn on, tc on then off, mo held, ea +4, er +2
  for (const id of ['tn', 'tc', 'tc']) {
    d.setButton(id, true);
    await d.advance(10);
    d.setButton(id, false);
    await d.advance(10);
  }
  d.setButton('mo', true);
  d.turnEncoder('ea', 4);
  d.turnEncoder('er', 2);
  await d.advance(60);
  d.setAnalog('p1', 0.52); // inside p1's deadband: not sent, but the snapshot reports it
  d.setAnalog('p2', 0.9);
  await d.advance(20);
  await burst(() => d.sendMidi(REQ)); // USB
  d.setButton('mo', false);
  await d.advance(10);
  await burst(() => d.sendPortMidi!(REQ)); // UART
  await burst(() => d.sendPortMidi!([0xf0, 0x7d, 0xf8, 0x6b, 0x01, 0xf8, 0xf7])); // real-time bytes inside are ignored
  // replies to nothing else: unknown / malformed SysEx and a request cut short by a channel message
  await burst(() => (d.sendMidi([0xf0, 0x7d, 0x6b, 0x02, 0xf7]), d.sendMidi([0xf0, 0x01, 0x02, 0xf7]), d.sendPortMidi!([0xf0, 0x7d, 0x6b, 0x01, 0x90, 0x7f, 0xf7])));
  await burst(() => d.sendPortMidi!([0xf0, 0x7d, 0x6b, 0x01, 0x01, 0xf7])); // too long
  return { usb, port, mark };
}

for (const bootRequest of [false, true])
  test(`snapshot (small spec${bootRequest ? ', request before the first scan' : ''}): firmware == model, content, no reply to junk`, async () => {
    const model = await script(createModelDevice(small), bootRequest);
    const fw = await script(await createRp2040Device(small, firmware), bootRequest);
    expect(fw.usb).toEqual(model.usb);
    expect(fw.port).toEqual(fw.usb); // normal UART mirroring
    const slice = (r: typeof model, i: number) => r.usb.slice(r.mark[2 * i]!, r.mark[2 * i + 1]!);
    const base = bootRequest ? 1 : 0;
    if (bootRequest) {
      // served at the end of the first scan: every analog control (baselines), toggles OFF, no momentary, absolute encoder at min
      expect(slice(model, 0)).toEqual([[0xb1, 1, 64], [0xb1, 2, 20 + Math.floor((1024 * 80 + 2047) / 4095)], [0x80, 40, 0], [0xb1, 50, 5], [0xb1, 60, 10]]);
    }
    // USB request in the reached state; record order: p1 p2 tn tc mo ea (er is relative: nothing)
    const usbBurst = slice(model, base);
    expect(usbBurst).toEqual([
      [0xb1, 1, Math.floor((Math.round(0.52 * 4095) * 127 + 2047) / 4095)],
      [0xb1, 2, 20 + Math.floor((Math.round(0.9 * 4095) * 80 + 2047) / 4095)],
      [0x90, 40, 100], // tn on
      [0xb1, 50, 5], // tc toggled twice = off -> OFF message (CC min)
      [0x90, 41, 100], // mo held
      [0xb1, 60, 14], // ea: min 10 + 4 detents
    ]);
    expect(slice(model, base + 1).map((m) => m.join())).toEqual(usbBurst.map((m) => m.join()).filter((m) => !m.startsWith('144,41'))); // UART request, mo released
    expect(slice(model, base + 2).length).toBe(usbBurst.length - 1); // real-time bytes inside the request are ignored
    expect(slice(model, base + 3)).toEqual([]); // unknown SysEx, aborted request
    expect(slice(model, base + 4)).toEqual([]); // too long
    expect(fw.mark).toEqual(model.mark);
  });

test('snapshot on the mixer-6ch preset: firmware == model; one burst of 59 CC + 24 toggle states, bounded', async () => {
  const spec = allocatePins(EXAMPLES['mixer-6ch']!);
  const run = async (d: DeviceSim) => {
    const usb: number[][] = [];
    d.onMidi((m) => usb.push(m));
    spec.controls.forEach((c, i) => (c.kind === 'pot' || c.kind === 'fader') && d.setAnalog(c.id, ((i * 37) % 90) / 100 + 0.05));
    await d.advance(30);
    for (const id of ['ch1-mute', 'ch3-solo', 'ch6-cue']) (d.setButton(id, true), await d.advance(15), d.setButton(id, false), await d.advance(15));
    usb.length = 0;
    d.sendPortMidi!(REQ);
    await d.advance(30);
    return usb;
  };
  const model = await run(createModelDevice(spec));
  const fw = await run(await createRp2040Device(spec, firmware));
  expect(model.length).toBe(59 + 24); // 59 analog + 24 toggle states (2 momentary buttons are not held, the encoder is relative)
  expect(fw).toEqual(model);
});
