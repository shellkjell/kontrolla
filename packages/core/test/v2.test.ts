// Contract v2 semantics (CONTRACTS §2): digital mux, host MIDI feedback, meters, WS2812 frame, validation.
import { expect, test } from 'bun:test';
import { createModelDevice, validate } from '../src';
import type { ButtonControl, DeviceSpec } from '../src';

const sel: [number, number, number, number] = [2, 3, 4, 5];
const btn = (id: string, ch: number, over: Partial<ButtonControl> = {}): ButtonControl => ({
  id, kind: 'button', part: 'button-tact-6mm', mux: { id: 'd', channel: ch }, mode: 'momentary', debounceMs: 0,
  midi: { type: 'note', channel: 1, note: 40 + ch, velocity: 100 }, led: { index: ch, color: '#ff8040' }, ...over,
});
const spec = (over: Partial<DeviceSpec> = {}): DeviceSpec => ({
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 't',
  muxes: [{ id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital' }],
  controls: [btn('b0', 0), btn('b3', 3, { mode: 'toggle' }), btn('cc', 4, { midi: { type: 'cc', channel: 2, cc: 20, min: 7, max: 90 } })],
  meters: [{ id: 'm', part: 'meter-bar', ledStart: 5, ledCount: 10, midi: { channel: 1, cc: 30 } }],
  leds: { part: 'led-ws2812', pin: 16, count: 15, brightness: 255 },
  ...over,
});
const rig = (s = spec()) => {
  const d = createModelDevice(s);
  const midi: number[][] = [];
  const frames: { rgb: number[]; t: number }[] = [];
  d.onMidi((m) => midi.push(m));
  d.onLeds((rgb, t) => frames.push({ rgb: [...rgb], t }));
  const px = (i: number) => frames.at(-1)!.rgb.slice(i * 3, i * 3 + 3);
  return { d, midi, frames, px };
};
const sc = (...c: number[]) => c.map((x) => (x * 255) >> 8); // brightness 255
const tap = async (d: ReturnType<typeof rig>['d'], id: string) => {
  d.setButton(id, true);
  await d.advance(5);
  d.setButton(id, false);
  await d.advance(5);
};

test('digital mux buttons: only the pressed channel fires', async () => {
  const { d, midi } = rig();
  await d.advance(3);
  await tap(d, 'b0');
  await tap(d, 'cc');
  expect(midi).toEqual([[0x90, 40, 100], [0x80, 40, 0], [0xb1, 20, 90], [0xb1, 20, 7]]);
});

test('frame: first scan pushes, off = colour >> 4, on = colour, unreferenced = 0, dirty refresh every 10 scans', async () => {
  const { d, frames, px } = rig();
  await d.advance(25);
  expect(frames.map((f) => f.t)).toEqual([0]);
  expect(px(0)).toEqual(sc(0xff >> 4, 0x80 >> 4, 0x40 >> 4));
  expect(px(1)).toEqual([0, 0, 0]);
  d.setButton('b0', true);
  await d.advance(3); // edge at the scan where now=0 of this advance => dirty, but frame waits for scanCount % 10 == 0
  expect(frames.length).toBe(1);
  await d.advance(10);
  expect(frames.length).toBe(2);
  expect(frames[1]!.t).toBe(30);
  expect(px(0)).toEqual(sc(0xff, 0x80, 0x40));
  await d.advance(50); // quiescent: no more frames
  expect(frames.length).toBe(2);
});

test('brightness: (c * brightness) >> 8', async () => {
  const { d, px } = rig(spec({ leds: { part: 'led-ws2812', pin: 16, count: 15, brightness: 128 } }));
  await d.advance(2);
  expect(px(0)).toEqual([(15 * 128) >> 8, (8 * 128) >> 8, (4 * 128) >> 8]);
});

test('feedback: note on/off/vel0 and CC >=64 set the LED; no echo', async () => {
  const { d, midi, px } = rig();
  await d.advance(2);
  d.sendMidi([0x90, 40, 1]);
  await d.advance(10);
  expect(px(0)).toEqual(sc(0xff, 0x80, 0x40));
  d.sendMidi([0x90, 40, 0]);
  await d.advance(10);
  expect(px(0)).toEqual(sc(15, 8, 4));
  d.sendMidi([0x90, 40, 99]);
  d.sendMidi([0x80, 40, 64]); // note off wins over its velocity
  await d.advance(10);
  expect(px(0)).toEqual(sc(15, 8, 4));
  d.sendMidi([0xb1, 20, 64]);
  await d.advance(10);
  expect(px(4)).toEqual(sc(0xff, 0x80, 0x40));
  d.sendMidi([0xb1, 20, 63]);
  await d.advance(10);
  expect(px(4)).toEqual(sc(15, 8, 4));
  d.sendMidi([0xb0, 20, 127]); // wrong channel: ignored
  d.sendMidi([0x91, 40, 127]); // wrong channel: ignored
  await d.advance(10);
  expect(px(4)).toEqual(sc(15, 8, 4));
  expect(midi).toEqual([]);
});

test('feedback sets toggle state; next press flips from the DAW state; local edge overrides MIDI', async () => {
  const { d, midi, px } = rig();
  await d.advance(2);
  d.sendMidi([0x90, 43, 127]);
  await d.advance(10);
  await tap(d, 'b3'); // DAW said on => this press turns off
  expect(midi).toEqual([[0x80, 43, 0]]);
  await d.advance(10);
  expect(px(3)).toEqual(sc(15, 8, 4));
  // momentary: DAW lights it, local press/release overrides
  d.sendMidi([0x90, 40, 127]);
  await d.advance(10);
  expect(px(0)).toEqual(sc(0xff, 0x80, 0x40));
  await tap(d, 'b0');
  await d.advance(10);
  expect(px(0)).toEqual(sc(15, 8, 4));
});

test('meters: lit = floor((v*n + 126)/127); green < 60 %, amber < 85 %, red above; unlit = 0', async () => {
  const { d, px } = rig();
  await d.advance(2);
  const lit = async (v: number) => {
    d.sendMidi([0xb0, 30, v]);
    await d.advance(10);
    return Array.from({ length: 10 }, (_, i) => px(5 + i).join(','));
  };
  expect((await lit(0)).every((c) => c === '0,0,0')).toBe(true);
  expect((await lit(1)).filter((c) => c !== '0,0,0').length).toBe(1);
  expect((await lit(64)).filter((c) => c !== '0,0,0').length).toBe(Math.floor((64 * 10 + 126) / 127));
  const full = await lit(127);
  expect(full).toEqual([...Array(6).fill(sc(0, 255, 0).join(',')), ...Array(3).fill(sc(255, 160, 0).join(',')), sc(255, 0, 0).join(',')]);
});

const msgs = (s: DeviceSpec, sev: 'error' | 'warning' | 'info' = 'error') => validate(s).filter((i) => i.severity === sev).map((i) => i.message);

test('validate: shared select bus allowed; different S position, reuse, bad sig rejected', () => {
  const ok = spec({
    muxes: [
      { id: 'd', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital' },
      { id: 'a', part: 'mux-74hc4067', sigPin: 26, selectPins: sel, signal: 'analog' },
    ],
    controls: [btn('b0', 0)],
    meters: [], leds: undefined,
  });
  ok.controls = [{ ...btn('b0', 0), led: undefined }];
  expect(msgs(ok)).toEqual([]);

  const swapped = structuredClone(ok);
  swapped.muxes[1]!.selectPins = [3, 2, 4, 5];
  expect(msgs(swapped).some((m) => /S1 on a but S0 on d|S0 on a but S1 on d/.test(m))).toBe(true);

  const reused = structuredClone(ok);
  reused.controls = [{ ...btn('x', 1), mux: undefined, pin: 3, led: undefined }];
  expect(msgs(reused).some((m) => /Pin 3 used more than once/.test(m))).toBe(true);

  const badSig = structuredClone(ok);
  badSig.muxes[1]!.sigPin = 9;
  expect(msgs(badSig).some((m) => /not ADC-capable/.test(m))).toBe(true);
  badSig.muxes[1]!.signal = 'digital'; // any GPIO is fine for a digital mux
  expect(msgs(badSig).some((m) => /not ADC-capable/.test(m))).toBe(false);
});

test('validate: button on analog mux / pot on digital mux', () => {
  const s = spec({ muxes: [{ id: 'd', part: 'mux-74hc4067', sigPin: 26, selectPins: sel, signal: 'analog' }] });
  expect(msgs(s).some((m) => /on analog mux/.test(m))).toBe(true);
});

test('validate: LED indices, overlap, meter range', () => {
  const s = spec();
  expect(msgs(s)).toEqual([]);
  s.controls[0] = btn('b0', 0, { led: { index: 7, color: '#ffffff' } }); // inside meter 5..14
  expect(msgs(s).some((m) => /LED 7 is claimed by both/.test(m))).toBe(true);
  const out = spec();
  out.controls[0] = btn('b0', 0, { led: { index: 15, color: '#ffffff' } });
  expect(msgs(out).some((m) => /outside the chain/.test(m))).toBe(true);
  const meter = spec();
  meter.meters![0]!.ledStart = 8;
  expect(msgs(meter).some((m) => /Meter m LEDs 8-17 are outside/.test(m))).toBe(true);
  const dup = spec();
  dup.controls[1] = btn('b3', 3, { led: { index: 0, color: '#ffffff' } });
  expect(msgs(dup).some((m) => /LED 0 is claimed by both b0 and b3/.test(m))).toBe(true);
});

test('validate: 5 V budget warning gives a safe brightness; level-shifter info', () => {
  const s = spec({ leds: { part: 'led-ws2812', pin: 16, count: 100, brightness: 255 } });
  s.controls = [btn('b0', 0)];
  s.meters = [];
  const w = validate(s).find((i) => i.severity === 'warning' && /5 V/.test(i.message))!;
  expect(w.message).toContain('6100 mA');
  expect(w.fix).toContain('brightness to 12'); // floor(255 * (400/100 - 1) / 60)
  expect(validate(s).some((i) => i.severity === 'info' && /74AHCT125/.test(i.message))).toBe(true);
  s.leds!.brightness = 12; // the suggested safe value
  expect(validate(s).some((i) => i.severity === 'warning' && /5 V/.test(i.message))).toBe(false);
});

test('teensy sketch carries mux buttons, feedback handler and LEDs', async () => {
  const { generateTeensySketch } = await import('../src');
  const s = spec({ mcu: 'teensy41' });
  const code = generateTeensySketch(s);
  expect(code).toContain('UNCOMPILED');
  expect(code).toContain('FastLED.addLeds<WS2812, 16, GRB>');
  expect(code).toContain('onFeedback(0x90');
  expect(code).toContain('INPUT_PULLUP');
  expect(code).toContain('static const uint8_t NMETER = 1;');
  expect(code).toContain('{6, {2, 3, 4, 5}, 1}, // d');
});
