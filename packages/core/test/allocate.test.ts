import { expect, test } from 'bun:test';
import { EXAMPLES, allocatePins, bom, encodeConfig, generateTeensySketch, validate } from '../src';

const problems = (s: Parameters<typeof validate>[0]) => validate(s).filter((i) => i.severity !== 'info');

test('starter allocates clean (4th pot forces a mux: Pico has 3 ADC pins)', () => {
  const s = allocatePins(EXAMPLES.starter!);
  expect(problems(s)).toEqual([]);
  expect(s.muxes.length).toBe(1);
  expect(encodeConfig(s).length).toBe(52 + 8 + 8 + 20 * 8 + 4);
  expect(bom(s).wiring.length).toBe(9);
});

test('big-knobs gets a mux, is deterministic', () => {
  const s = allocatePins(EXAMPLES['big-knobs']!);
  expect(s.muxes.length).toBe(1);
  expect(problems(s)).toEqual([]);
  expect(allocatePins(EXAMPLES['big-knobs']!)).toEqual(s);
});

test('teensy example: no mux, sketch generated', () => {
  const s = allocatePins(EXAMPLES['teensy-mixer']!);
  expect(s.muxes.length).toBe(0);
  expect(problems(s)).toEqual([]);
  expect(generateTeensySketch(s)).toContain('usbMIDI.sendControlChange');
});

test('seeded conflicts produce errors', () => {
  const s = allocatePins(EXAMPLES.starter!);
  const btns = s.controls.filter((c) => c.kind === 'button');
  if (btns[0]?.kind === 'button' && btns[1]?.kind === 'button') btns[1].pin = btns[0].pin;
  const first = s.controls[0]!;
  if (first.kind === 'pot') first.pin = 12; // non-ADC
  const errs = validate(s).filter((i) => i.severity === 'error').map((i) => i.message);
  expect(errs.some((m) => m.includes('used more than once'))).toBe(true);
  expect(errs.some((m) => m.includes('not ADC-capable'))).toBe(true);
});

test('warnings: low deadband, duplicate midi target; reserved pin', () => {
  const s = allocatePins(EXAMPLES.starter!);
  const [a, b] = s.controls;
  if (a?.kind === 'pot' && b?.kind === 'pot') ((a.deadband = 2), (b.midi.cc = a.midi.cc));
  const w = validate(s).filter((i) => i.severity === 'warning').map((i) => i.message);
  expect(w.some((m) => m.includes('deadband'))).toBe(true);
  expect(w.some((m) => m.includes('same MIDI target'))).toBe(true);
  const btn = s.controls.find((c) => c.kind === 'button');
  if (btn?.kind === 'button') btn.pin = 25;
  expect(validate(s).some((i) => i.message.includes('reserved'))).toBe(true);
});
