import { expect, test } from 'bun:test';
import type { DeviceSpec } from '../src';
import { EXAMPLES, allocatePins, autoLayout, bom, buildSteps, duplicateGroup, ensureLayout, groupOf, nextFreeMidi, validate, validateLayout } from '../src';

const errors = (s: Parameters<typeof validate>[0]) => validate(s).filter((i) => i.severity === 'error');

test('mixer-6ch fits a Pico: 3 analog + digital muxes on one select bus, no errors', () => {
  const s = allocatePins(EXAMPLES['mixer-6ch']!);
  expect(errors(s)).toEqual([]);
  const analog = s.muxes.filter((m) => m.signal === 'analog');
  expect(analog.length).toBe(3);
  expect(s.muxes.some((m) => m.signal === 'digital')).toBe(true);
  expect(new Set(s.muxes.map((m) => m.selectPins.join())).size).toBe(1);
  expect(s.leds?.pin).toBeDefined();
  expect(s.leds?.count).toBe(83);
  expect(allocatePins(EXAMPLES['mixer-6ch']!)).toEqual(s);
  expect(bom(s).totalUsd).toBeGreaterThan(50);
  expect(buildSteps(s).map((x) => x.title)).toContain('LED chain (data line order)');
});

test('duplicateGroup: ids, labels, MIDI offset, LEDs, placement', () => {
  const m = EXAMPLES['mixer-6ch']!;
  const g = m.groups!.find((x) => x.id === 'ch1')!;
  expect(m.groups!.map((x) => x.label).slice(0, 6)).toEqual(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 6']);
  const gain2 = m.controls.find((c) => c.id === 'ch2-gain')!;
  expect(gain2.midi.type === 'cc' && gain2.midi.cc).toBe(12 + 8);
  const mute3 = m.controls.find((c) => c.id === 'ch3-mute')!;
  expect(mute3.midi.type === 'note' && mute3.midi.note).toBe(24 + 6);
  expect(groupOf(m, 'ch4-solo')?.id).toBe('ch4');
  const leds = [...m.controls.flatMap((c) => (c.kind === 'button' && c.led ? [c.led.index] : [])), ...m.meters!.flatMap((x) => Array.from({ length: x.ledCount }, (_, i) => x.ledStart + i))];
  expect(new Set(leds).size).toBe(leds.length);
  expect(g.members.length).toBe(11);
  expect(m.layout!.placements['ch2-gain']!.x).toBeGreaterThan(m.layout!.placements['ch1-gain']!.x);
});

test('duplicateGroup moves to the next channel when CC numbers run out', () => {
  let s = EXAMPLES['mixer-6ch']!;
  s = duplicateGroup(s, 'ch6', 9); // ch15's block would end past CC 127
  const last = s.controls.find((c) => c.id === 'ch15-gain')!;
  expect(last.midi.channel).toBeGreaterThan(1);
});

test('nextFreeMidi', () => {
  const s = EXAMPLES.starter!;
  expect(nextFreeMidi(s, 'cc', 1)?.number).toBe(1);
  expect(nextFreeMidi(s, 'note', 1)?.number).toBe(0);
});

test('autoLayout has no overlaps and no errors for all presets', () => {
  for (const [name, spec] of Object.entries(EXAMPLES)) {
    expect(spec.layout, name).toBeDefined();
    const bad = validateLayout(spec).filter((i) => i.severity !== 'info');
    expect(bad, name).toEqual([]);
    expect(autoLayout(spec)).toEqual(spec.layout!);
  }
});

test('validateLayout catches a seeded overlap, an edge cut and a missing placement', () => {
  const s = structuredClone(EXAMPLES.starter!);
  s.layout!.placements.pot2 = { ...s.layout!.placements.pot1! };
  s.layout!.placements.pot3 = { x: 1, y: 1 };
  delete s.layout!.placements.btn1;
  const msgs = validateLayout(s);
  expect(msgs.some((i) => i.severity === 'error' && i.message.includes('overlap'))).toBe(true);
  expect(msgs.some((i) => i.severity === 'error' && i.message.includes('edge'))).toBe(true);
  expect(msgs.some((i) => i.severity === 'info' && i.controlId === 'btn1')).toBe(true);
  expect(ensureLayout(s).layout!.placements.btn1).toBeDefined();
});

test('finger clearance warning', () => {
  const s = structuredClone(EXAMPLES.starter!);
  const a = s.layout!.placements.pot1!;
  s.layout!.placements.pot2 = { x: a.x + 16, y: a.y };
  expect(validateLayout(s).some((i) => i.severity === 'warning' && i.message.includes('hard to turn'))).toBe(true);
});

test('duplicateGroup gives unique ids when member ids are consecutive', async () => {
  const { createGroup } = await import('../src');
  const pot = (id: string) => ({ id, kind: 'pot' as const, part: 'pot-b10k', midi: { type: 'cc' as const, channel: 1, cc: id === 'pot1' ? 1 : 2, min: 0, max: 127 }, deadband: 12, smoothing: 0 });
  let spec: DeviceSpec = { ...EXAMPLES.starter!, controls: [pot('pot1'), pot('pot2')], muxes: [], groups: [], layout: undefined, meters: [], leds: undefined };
  spec = createGroup(spec, 'Ch 1', ['pot1', 'pot2'], { kind: 'strip' });
  const ids = duplicateGroup(spec, spec.groups![0]!.id, 2).controls.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});
