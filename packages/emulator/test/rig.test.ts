import { expect, test } from 'bun:test';
import { Rp2040Rig } from '../src';
import { firmware, potButtonBlob } from './helpers';

const msgs = (r: Rp2040Rig) => {
  const out: number[][] = [];
  r.onMidi((m) => out.push(m));
  return out;
};

test('enumerates with product from blob', () => {
  const r = new Rp2040Rig(firmware, potButtonBlob());
  r.runUntil(2000e6, () => r.usbState === 'configured');
  expect(r.usbState).toBe('configured');
  expect(r.product).toBe('Test Pot+Button');
  expect(r.timeMs).toBeLessThan(500);
});

const boot = (blob: Uint8Array) => {
  const r = new Rp2040Rig(firmware, blob);
  r.runUntil(2000e6, () => r.usbState === 'configured');
  return r;
};

test('pot -> CC1, button -> note 60', () => {
  const r = boot(potButtonBlob());
  const out = msgs(r);
  r.run(5); // first scan latches the baseline
  r.rp.adc.channelValues[0] = 4095;
  r.run(20);
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((m) => m[0] === 0xb0 && m[1] === 1)).toBe(true);
  expect(out.at(-1)).toEqual([0xb0, 1, 127]);
  out.length = 0;
  r.rp.gpio[15]!.setInputValue(false);
  r.run(20);
  expect(out).toEqual([[0x90, 60, 100]]);
  r.rp.gpio[15]!.setInputValue(true);
  r.run(20);
  expect(out.at(-1)).toEqual([0x80, 60, 0]);
});

test('corrupt CRC -> "kont.rolla (no config)", silent', () => {
  const r = boot(potButtonBlob(true));
  const out = msgs(r);
  expect(r.product).toBe('kont.rolla (no config)');
  r.rp.adc.channelValues[0] = 4095;
  r.rp.gpio[15]!.setInputValue(false);
  r.run(50);
  expect(out).toEqual([]);
});
