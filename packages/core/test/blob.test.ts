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

test('blob golden: 1 pot', () => {
  const b = encodeConfig(spec);
  const expected = [
    0x4b, 0x52, 0x4c, 0x31, // magic
    1, 0, // version
    64, 0, // total length
    1, 0, 0, 0, // controlCount, muxCount, reserved
    0x54, ...new Array(31).fill(0), // "T" + NUL padding
    1, 0, 0xff, 0xff, 0, 1, 0, 7, 0, 127, 0, 0, 8, 0, 0, 0, // control record
  ];
  expect([...b.subarray(0, 60)]).toEqual(expected);
  expect(new DataView(b.buffer).getUint32(60, true)).toBe(Bun.hash.crc32(b.subarray(0, 60)));
  expect(decodeConfig(b).controls[0]).toMatchObject({ kind: 1, pinA: 0, number: 7, max: 127, deadband: 8 });
});

test('blob rejects teensy and bad crc', () => {
  expect(() => encodeConfig({ ...spec, mcu: 'teensy41' })).toThrow();
  const b = encodeConfig(spec);
  b[20] = b[20]! ^ 1;
  expect(() => decodeConfig(b)).toThrow('bad crc');
});
