import { expect, test } from 'bun:test';
import { allocatePins, validate } from '@kontrolla/core';
import { EXAMPLE_PROMPTS, chips, parsePlan, planToSpec } from '../src/features/describe';

const plan = (t: string) => parsePlan(t)!;

test('counts next to nouns, digits or words', () => {
  expect(plan('8 knobs for my synth')).toMatchObject({ pots: 8, synth: true });
  expect(plan('eight rotary knobs and two faders')).toMatchObject({ pots: 8, faders: 2 });
  expect(plan('16 pads and 4 faders')).toMatchObject({ pads: 16, faders: 4 });
  expect(plan('a dozen pots, 2 encoders & 3 buttons')).toMatchObject({ pots: 12, encoders: 2, buttons: 3 });
  expect(plan('kick-snare pedal with 3 buttons')).toMatchObject({ buttons: 3 });
});

test('grids and mixers', () => {
  expect(plan('4×4 pad grid')).toMatchObject({ pads: 16, grid: [4, 4] });
  expect(plan('6-channel DJ mixer with EQ')).toMatchObject({ mixer: 6, pots: 0 });
  expect(plan('a mixer')).toMatchObject({ mixer: 4 });
  expect(plan('twelve channel mixer')).toMatchObject({ mixer: 6 }); // capped: the engine boards stop at six
});

test('nothing recognisable gives null; absurd counts are capped', () => {
  expect(parsePlan('something nice')).toBeNull();
  expect(parsePlan('')).toBeNull();
  expect(plan('500 knobs').pots).toBeLessThanOrEqual(32);
});

test('chips repeat what was understood', () => {
  expect(chips(plan('8 knobs and 1 fader')).map((c) => c.label)).toEqual(['8 knobs', '1 fader']);
});

test('every example prompt builds a design that passes the pin check', () => {
  for (const text of EXAMPLE_PROMPTS) {
    const spec = planToSpec(plan(text), 'rp2040-pico');
    expect(spec.controls.length).toBeGreaterThan(0);
    expect(spec.layout).toBeDefined();
    const errors = validate(allocatePins(spec)).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
  }
});

test('8 knobs make a grid, not a column', () => {
  const spec = planToSpec(plan('8 knobs for my synth'), 'rp2040-pico');
  const { width, depth } = spec.layout!.panel;
  expect(Math.max(width, depth) / Math.min(width, depth)).toBeLessThan(2.5);
  expect(spec.controls[0]!.label).toBe('Cutoff');
});

test('a 4x4 grid has four columns', () => {
  const spec = planToSpec(plan('4x4 pad grid'), 'rp2040-pico');
  const xs = new Set(spec.controls.map((c) => Math.round(spec.layout!.placements[c.id]!.x)));
  expect(xs.size).toBe(4);
});

test('a 3-channel mixer is the proven preset trimmed, a 2-channel one drops a strip', () => {
  expect(planToSpec(plan('3 channel mixer'), 'rp2040-pico').audio!.channels).toHaveLength(3);
  const two = planToSpec(plan('2 channel mixer'), 'rp2040-pico');
  expect(two.audio!.channels).toHaveLength(2);
  expect(two.ioSlots).toHaveLength(2);
});
