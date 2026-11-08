import { expect, test } from 'bun:test';
import { crc32, decodeConfig, encodeConfig } from '../src';
import type { DeviceSpec } from '../src';

test('crc32 known vector', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

const spec: DeviceSpec = {
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 'T', muxes: [],
  controls: [{
    id: 'p', kind: 'pot', part: 'pot-b10k', pin: 26,
    midi: { type: 'cc', channel: 1, cc: 7, min: 0, max: 127 }, deadband: 8, smoothing: 0,
  }],
};

test('blob v3 golden: 1 pot, no LEDs', () => {
  const b = encodeConfig(spec);
  const expected = [
    0x4b, 0x52, 0x4c, 0x31, // magic
    3, 0, // version
    84, 0, // total length
    1, 0, 0, 0, // controlCount, muxCount, meterCount, reserved
    0x54, ...new Array(31).fill(0), // "T" + NUL padding
    0xff, 0, 0, 0, 0, 0, 0, 0, // LED record: pin none, count 0, brightness 0
    0xff, 0xff, 0, 0, 0, 0, 0, 0, // MIDI port record: no tx, no rx
    1, 0, 0xff, 0xff, 0, 1, 0, 7, 0, 127, 0, 0, 8, 0, 0xff, 0, 0, 0, 0, 0, // control record (20 B)
  ];
  expect([...b.subarray(0, 80)]).toEqual(expected);
  expect(new DataView(b.buffer).getUint32(80, true)).toBe(Bun.hash.crc32(b.subarray(0, 80)));
  expect(decodeConfig(b).controls[0]).toMatchObject({ kind: 1, pinA: 0, number: 7, max: 127, deadband: 8, led: 0xff });
});

test('blob v3 golden: digital mux with EN + illuminated toggle button + meter + LED chain + MIDI port', () => {
  const s: DeviceSpec = {
    version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 'T',
    muxes: [{ id: 'd', part: 'mux-74hc4067', sigPin: 9, selectPins: [2, 3, 4, 5], signal: 'digital', enablePin: 7 }],
    controls: [{
      id: 'b', kind: 'button', part: 'button-tact-6mm', mux: { id: 'd', channel: 3 }, mode: 'toggle', debounceMs: 4,
      midi: { type: 'note', channel: 2, note: 60, velocity: 100 }, led: { index: 1, color: '#ff8000' },
    }],
    meters: [{ id: 'm', part: 'meter-bar', ledStart: 2, ledCount: 8, midi: { channel: 3, cc: 7 } }],
    leds: { part: 'led-ws2812', pin: 6, count: 10, brightness: 128 },
    midiPort: { part: 'midi-trs-a', txPin: 0, rxPin: 1 },
  };
  const b = encodeConfig(s);
  expect(b.length).toBe(44 + 8 + 8 + 8 + 20 + 8 + 4);
  expect(new DataView(b.buffer).getUint16(4, true)).toBe(3);
  expect([...b.subarray(8, 12)]).toEqual([1, 1, 1, 0]);
  expect([...b.subarray(44, 52)]).toEqual([6, 10, 128, 0, 0, 0, 0, 0]); // LED record
  expect([...b.subarray(52, 60)]).toEqual([0, 1, 0, 0, 0, 0, 0, 0]); // MIDI port record: tx, rx
  expect([...b.subarray(60, 68)]).toEqual([9, 2, 3, 4, 5, 1, 7, 0]); // mux record: sig, S0..S3, digital, EN
  expect([...b.subarray(68, 88)]).toEqual([2, 0xff, 0xff, 0, 3, 2, 1, 60, 0, 100, 1, 4, 0, 0, 1, 0xff, 0x80, 0, 0, 0]);
  expect([...b.subarray(88, 96)]).toEqual([2, 7, 2, 8, 0, 0, 0, 0]); // meter record
  expect(new DataView(b.buffer).getUint32(96, true)).toBe(Bun.hash.crc32(b.subarray(0, 96)));
  const d = decodeConfig(b);
  expect(d.meters).toEqual([{ channel: 2, cc: 7, ledStart: 2, ledCount: 8 }]);
  expect(d.port).toEqual({ tx: 0, rx: 1 });
  expect(d.muxes[0]).toMatchObject({ sig: 9, signal: 1, en: 7 });
  expect(d.controls[0]).toMatchObject({ muxIndex: 0, muxChannel: 3, led: 1, rgb: [255, 128, 0] });
  // a mux without EN, and a v2 blob, are distinguishable / rejected
  s.muxes[0]!.enablePin = undefined;
  expect(decodeConfig(encodeConfig(s)).muxes[0]!.en).toBe(0xff);
  const v2 = encodeConfig(s);
  v2[4] = 2;
  expect(() => decodeConfig(v2)).toThrow('bad version');
});

test('blob rejects teensy and bad crc', () => {
  expect(() => encodeConfig({ ...spec, mcu: 'teensy41' })).toThrow();
  const b = encodeConfig(spec);
  b[20] = b[20]! ^ 1; // inside the product name
  expect(() => decodeConfig(b)).toThrow('bad crc');
});
