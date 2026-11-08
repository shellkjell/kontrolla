// Contract v3 (CONTRACTS §2.3, §2.4): UART MIDI port semantics in the model, mux-enable and port validation.
import { expect, test } from 'bun:test';
import { createModelDevice, generateTeensySketch, validate } from '../src';
import type { ButtonControl, DeviceSpec } from '../src';

const sel: [number, number, number, number] = [2, 3, 4, 5];
const btn = (id: string, ch: number, over: Partial<ButtonControl> = {}): ButtonControl => ({
  id, kind: 'button', part: 'button-tact-6mm', mux: { id: 'd', channel: ch }, mode: 'momentary', debounceMs: 0,
  midi: { type: 'note', channel: 1, note: 40 + ch, velocity: 100 }, led: { index: ch, color: '#ff8040' }, ...over,
});
const spec = (over: Partial<DeviceSpec> = {}): DeviceSpec => ({
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 't',
  muxes: [{ id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital' }],
  controls: [btn('b0', 0), btn('b3', 3, { mode: 'toggle' })],
  meters: [{ id: 'm', part: 'meter-bar', ledStart: 5, ledCount: 10, midi: { channel: 1, cc: 30 } }],
  leds: { part: 'led-ws2812', pin: 16, count: 15, brightness: 255 },
  midiPort: { part: 'midi-trs-a', txPin: 0, rxPin: 1 },
  ...over,
});
const errs = (s: DeviceSpec) => validate(s).filter((i) => i.severity === 'error').map((i) => i.message);

test('port: every USB message is mirrored on the port, same order; no port TX pin = no mirror', async () => {
  const d = createModelDevice(spec());
  const usb: number[][] = [];
  const port: number[][] = [];
  d.onMidi((m) => usb.push(m));
  d.onPortMidi!((m) => port.push(m));
  await d.advance(2);
  for (const id of ['b0', 'b3', 'b0']) {
    d.setButton(id, true);
    await d.advance(3);
    d.setButton(id, false);
    await d.advance(3);
  }
  expect(usb.length).toBe(5);
  expect(port).toEqual(usb);
  const q = createModelDevice(spec({ midiPort: { part: 'midi-trs-a', rxPin: 1 } }));
  const none: number[][] = [];
  q.onPortMidi!((m) => none.push(m));
  q.setButton('b0', true);
  await q.advance(5);
  expect(none).toEqual([]);
});

test('port RX: running status, real-time bytes ignored, SysEx clears running status; same effects as USB; no echo', async () => {
  const d = createModelDevice(spec());
  const frames: number[][] = [];
  const out: number[][] = [];
  d.onLeds((rgb) => frames.push([...rgb]));
  d.onMidi((m) => out.push(m));
  d.onPortMidi!((m) => out.push(m));
  await d.advance(2);
  const led = (i: number) => frames.at(-1)!.slice(i * 3, i * 3 + 3);
  d.sendPortMidi!([0x90, 40, 127]); // b0 on
  await d.advance(10);
  expect(led(0)).toEqual([255 * 255 >> 8, 128 * 255 >> 8, 64 * 255 >> 8]);
  d.sendPortMidi!([40, 0]); // running status: note on, velocity 0 = off
  await d.advance(10);
  expect(led(0)).toEqual([15 * 255 >> 8, 8 * 255 >> 8, 4 * 255 >> 8]);
  d.sendPortMidi!([0xb0, 30, 127, 0xf8, 30, 0]); // meter full, a real-time byte, running-status CC 0
  await d.advance(10);
  expect(led(5)).toEqual([0, 0, 0]);
  d.sendPortMidi!([0xb0, 30, 127]);
  await d.advance(10);
  expect(led(14)).toEqual([255 * 255 >> 8, 0, 0]);
  d.sendPortMidi!([0xf0, 1, 2, 0xf7, 30, 0]); // SysEx kills running status: "30, 0" is dropped
  await d.advance(10);
  expect(led(14)).toEqual([255 * 255 >> 8, 0, 0]);
  d.sendPortMidi!([0xb0, 30, 0xb0, 30, 64]); // a new status abandons the incomplete message
  await d.advance(10);
  expect(led(14)).toEqual([0, 0, 0]); // 64 lights 6 segments
  expect(led(10)).toEqual([0, 255 * 255 >> 8, 0]);
  expect(out).toEqual([]);
  // without an RX pin the port ignores input
  const t = createModelDevice(spec({ midiPort: { part: 'midi-trs-a', txPin: 0 } }));
  const fr: number[][] = [];
  t.onLeds((rgb) => fr.push([...rgb]));
  await t.advance(2);
  t.sendPortMidi!([0x90, 40, 127]);
  await t.advance(10);
  expect(fr.at(-1)!.slice(0, 3)).toEqual([15 * 255 >> 8, 8 * 255 >> 8, 4 * 255 >> 8]);
});

test('digital muxes sharing a SIG pin keep their own channels', async () => {
  const s = spec({
    muxes: [
      { id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 10 },
      { id: 'e', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 11 },
    ],
    controls: [btn('b0', 0), btn('e0', 0, { mux: { id: 'e', channel: 0 }, midi: { type: 'note', channel: 1, note: 99, velocity: 100 }, led: undefined })],
  });
  const d = createModelDevice(s);
  const out: number[][] = [];
  d.onMidi((m) => out.push(m));
  await d.advance(2);
  d.setButton('e0', true);
  await d.advance(5);
  expect(out).toEqual([[0x90, 99, 100]]);
});

test('validate: shared SIG pins need distinct EN pins on every mux', () => {
  const shared = spec({
    muxes: [
      { id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 10 },
      { id: 'e', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 11 },
    ],
    controls: [btn('b0', 0)],
    meters: [], leds: undefined,
  });
  shared.controls = [{ ...btn('b0', 0), led: undefined }];
  expect(errs(shared)).toEqual([]);

  const noEn = structuredClone(shared);
  noEn.muxes[1]!.enablePin = undefined;
  expect(errs(noEn).some((m) => /share SIG pin 6 but not every one has an enable pin/.test(m))).toBe(true);

  const sameEn = structuredClone(shared);
  sameEn.muxes[1]!.enablePin = 10;
  expect(errs(sameEn).some((m) => /Pin 10 used more than once/.test(m))).toBe(true);

  const enElsewhere = structuredClone(shared);
  enElsewhere.muxes[1]!.enablePin = 2; // a select pin
  expect(errs(enElsewhere).some((m) => /Pin 2 used more than once/.test(m))).toBe(true);

  const mixed = structuredClone(shared);
  mixed.muxes[1]!.signal = 'analog';
  expect(errs(mixed).some((m) => /share SIG pin 6/.test(m) && /digital/.test(m) && /analog/.test(m))).toBe(true);

  const analogOk = spec({
    muxes: [
      { id: 'a', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 7 },
      { id: 'b', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 8 },
    ],
    controls: [], meters: [], leds: undefined,
  });
  expect(errs(analogOk)).toEqual([]);
});

test('validate: MIDI port pins must be a legal UART pair', () => {
  const ok = (tx: number | undefined, rx: number | undefined) => errs(spec({ midiPort: { part: 'midi-din5', txPin: tx, rxPin: rx } }));
  expect(ok(0, 1)).toEqual([]);
  expect(ok(8, 9)).toEqual([]);
  expect(ok(12, undefined)).toEqual([]);
  expect(ok(7, 1).some((m) => /not a UART TX pin/.test(m))).toBe(true);
  expect(ok(0, 9).some((m) => /different UARTs/.test(m))).toBe(true);
  expect(ok(0, 17)).toEqual([]);
  expect(ok(0, 3).some((m) => /not a UART RX pin/.test(m))).toBe(true);
  const teensy = spec({ mcu: 'teensy41', midiPort: { part: 'midi-din5', txPin: 8, rxPin: 0 }, leds: undefined, meters: [], controls: [] });
  expect(errs(teensy).some((m) => /Serial1 TX/.test(m))).toBe(true);
});

test('validate: scan budget (bus-major) warns past 1 ms, always reports an estimate', () => {
  const muxes = Array.from({ length: 13 }, (_, k) => ({ id: `a${k}`, part: 'mux-74hc4067' as const, sigPin: 26, selectPins: sel, signal: 'analog' as const, enablePin: 7 + k }));
  const pots = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, kind: 'pot' as const, part: 'pot-b10k', mux: { id: `a${i >> 4}`, channel: i % 16 },
      midi: { type: 'cc' as const, channel: 1, cc: i % 128, min: 0, max: 127 }, deadband: 8, smoothing: 0,
    }));
  const big = spec({ muxes, controls: pots(208), meters: [], leds: undefined, midiPort: undefined });
  expect(validate(big).some((i) => i.severity === 'warning' && /Scan needs/.test(i.message))).toBe(true);
  const ok = spec({ muxes: muxes.slice(0, 4), controls: pots(59), meters: [], leds: undefined, midiPort: undefined });
  const est = validate(ok).find((i) => /Scan needs/.test(i.message))!;
  expect(est.severity).toBe('info');
  // 16 channels x 10 us settle + EN switches + 59 x 3.5 us reads + 59 x 1.2 us processing
  expect(Number(/~(\d+) µs/.exec(est.message)![1])).toBeGreaterThan(400);
  expect(Number(/~(\d+) µs/.exec(est.message)![1])).toBeLessThan(600);
});

test('teensy sketch: EN handling and Serial1 mirror/input', () => {
  const s = spec({
    mcu: 'teensy41',
    muxes: [{ id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 10 }],
    midiPort: { part: 'midi-din5', txPin: 1, rxPin: 0 },
  });
  const code = generateTeensySketch(s);
  expect(code).toContain('{6, {2, 3, 4, 5}, 1, 10}, // d');
  expect(code).toContain('digitalWrite(m.en, LOW)');
  expect(code).toContain('Serial1.begin(31250)');
  expect(code).toContain('Serial1.write(status)');
  expect(code).toContain('portRxByte(Serial1.read())');
  expect(code).toContain('UNCOMPILED');
  // snapshot request (CONTRACTS 2.5)
  expect(code).toContain('static void snapshot()');
  expect(code).toContain('usbMIDI.SystemExclusive');
  expect(code).toContain('sxBuf[0] == 0x7D && sxBuf[1] == 0x6B && sxBuf[2] == 0x01');
  expect(code).toContain('if (snapReq) { snapReq = false; snapshot(); }');
});
