import { expect, test } from 'bun:test';
import { EXAMPLES, boxOf, duplicateGroup, validateLayout } from '@kontrolla/core';
import { alignPlacements, distributePlacements, snapMove } from '../src/components/layout/geometry';
import type { Rect } from '../src/components/layout/geometry';
import { applyStripPattern, duplicateStrip, removeItems, stripInfo } from '../src/components/layout/ops';

const box = (x: number, y: number, w = 10, h = 10): Rect => ({ x, y, w, h });

test('snapMove: grid snaps the dragged centre; a neighbour centre wins within the threshold', () => {
  const boxes = new Map([['a', box(0, 0)], ['b', box(40, 0)]]); // centres (5,5) and (45,5)
  const base = { origin: { a: { x: 5, y: 5 } }, primary: 'a', boxes, step: 5, threshold: 2, panel: { width: 200, depth: 200 } };
  expect(snapMove({ ...base, delta: { x: 12.6, y: 31 } }).delta).toEqual({ x: 15, y: 30 }); // no neighbour near: grid
  const r = snapMove({ ...base, delta: { x: 12, y: 1.2 } }); // y centre ~6.2 is 1.2 from b's centre 5 -> aligns
  expect(r.delta.y).toBeCloseTo(0);
  expect(r.guides.some((g) => g.axis === 'y')).toBe(true);
});

test('align and distribute', () => {
  const boxes = new Map([['a', box(0, 0, 10, 10)], ['b', box(30, 20, 20, 20)], ['c', box(100, 5, 10, 10)]]);
  expect(alignPlacements(['a', 'b'], boxes, 'left')).toEqual({ a: { x: 5, y: 5 }, b: { x: 10, y: 30 } });
  expect(alignPlacements(['a', 'b'], boxes, 'bottom').a!.y).toBe(35); // shared bottom edge at 40, a is 10 tall
});

test('distribute keeps the ends and equalises the gaps', () => {
  const boxes = new Map([['a', box(0, 0)], ['b', box(20, 0)], ['c', box(90, 0)]]);
  const out = distributePlacements(['a', 'b', 'c'], boxes, 'x');
  expect(out.a!.x).toBe(5);
  expect(out.c!.x).toBe(95);
  expect(out.b!.x).toBe(50); // gaps of 35 on both sides
});

test('strip pattern: editing strip 1 and applying steps every other strip by the strip span', () => {
  let s = structuredClone(EXAMPLES['mixer-6ch']!);
  const info = stripInfo(s, 'ch1-gain')!;
  expect(info.strips.length).toBe(6);
  expect(info.stride).toBe(8); // CC 12..19
  s.controls.find((c) => c.id === 'ch1-gain')!.midi = { type: 'cc', channel: 2, cc: 30, min: 0, max: 127 };
  s = applyStripPattern(s, 'ch1-gain');
  const gains = [1, 2, 3, 4, 5, 6].map((n) => s.controls.find((c) => c.id === `ch${n}-gain`)!.midi);
  expect(gains.map((m) => (m.type === 'cc' ? [m.channel, m.cc] : []))).toEqual([[2, 30], [2, 38], [2, 46], [2, 54], [2, 62], [2, 70]]);
});

test('removeItems clears groups and placements; duplicated strips keep their places', () => {
  const s = duplicateGroup(EXAMPLES['mixer-6ch']!, 'ch1', 1);
  expect(boxOf(s, 'ch7-gain')).toBeDefined();
  const r = removeItems(s, ['ch7-gain', 'ch7-meter']);
  expect(r.layout!.placements['ch7-gain']).toBeUndefined();
  expect(r.groups!.find((g) => g.id === 'ch7')!.members).not.toContain('ch7-gain');
  expect(r.meters!.some((m) => m.id === 'ch7-meter')).toBe(false);
});

test('duplicateStrip seats copies after the last strip and pushes the master section along', () => {
  const src = EXAMPLES['mixer-6ch']!;
  const next = duplicateStrip(src, 'ch1', 2); // core alone would drop the copy on top of ch2
  expect(validateLayout(next).filter((i) => i.severity === 'error')).toEqual([]);
  const left = (s: typeof src, id: string) => boxOf(s, id)!.x;
  expect(left(next, 'ch7-gain')).toBeGreaterThan(left(next, 'ch6-gain'));
  expect(left(next, 'ch8-gain')).toBeGreaterThan(left(next, 'ch7-gain'));
  expect(left(next, 'booth')).toBeGreaterThan(left(next, 'ch8-gain'));
  expect(next.layout!.panel.width).toBeGreaterThan(src.layout!.panel.width);
});
