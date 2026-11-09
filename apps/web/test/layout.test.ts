import { expect, test } from 'bun:test';
import { EXAMPLES, boxOf, duplicateGroup, validateLayout } from '@kontrolla/core';
import { alignPlacements, distributePlacements, snapMove } from '../src/components/layout/geometry';
import type { Rect } from '../src/components/layout/geometry';
import { applyStripPattern, duplicateStrip, addMasterModule, fitBoard, mergeIssues, removeItems, removeMasterModule, setBoard, stripInfo, swapMasterModule, swapModule } from '../src/components/layout/ops';
import { boardUse, describeSwap, flipRear, ownerOfSlot } from '../src/components/layout/rear';

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
  // the span a strip really uses (ch2 is untouched): highest CC - lowest CC + 1, derived, not hardcoded
  const ccs = s.groups!.find((g) => g.id === 'ch2')!.members.flatMap((id) => {
    const c = s.controls.find((x) => x.id === id)?.midi ?? s.meters?.find((m) => m.id === id)?.midi;
    return c && !('note' in c) ? [c.cc] : [];
  });
  const span = Math.max(...ccs) - Math.min(...ccs) + 1;
  expect(info.stride).toBe(span);
  s.controls.find((c) => c.id === 'ch1-gain')!.midi = { type: 'cc', channel: 2, cc: 30, min: 0, max: 127 };
  s = applyStripPattern(s, 'ch1-gain');
  const gains = [1, 2, 3, 4, 5, 6].map((n) => s.controls.find((c) => c.id === `ch${n}-gain`)!.midi);
  expect(gains.map((m) => (m.type === 'cc' ? [m.channel, m.cc] : []))).toEqual([0, 1, 2, 3, 4, 5].map((j) => [2, 30 + j * span]));
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

test('swapModule changes only that slot; master swap keeps the slot in place', () => {
  const src = EXAMPLES['mixer-6ch']!;
  expect(src.ioSlots!.find((x) => x.id === 'ch5-io')!.module).toBe('io-xlr');
  const next = swapModule(src, 'ch5-io', 'io-dual-trs');
  expect(next.ioSlots!.map((x) => x.module).filter((m, i) => m !== src.ioSlots![i]!.module)).toEqual(['io-dual-trs']);
  expect(src.ioSlots!.find((x) => x.id === 'ch5-io')!.module).toBe('io-xlr'); // input untouched
  const at = src.layout!.placements['master:out-xlr-pair']!;
  const m = swapMasterModule(removeMasterModule(src, 'out-booth'), 'out-xlr-pair', 'out-booth');
  expect(src.audio!.master.outputs).toContain('out-xlr-pair');
  expect(m.audio!.master.outputs).not.toContain('out-xlr-pair');
  expect(m.layout!.placements['master:out-xlr-pair']).toBeUndefined();
  expect(m.layout!.placements['master:out-booth']).toEqual(at);
  expect(swapMasterModule(src, 'out-xlr-pair', 'out-trs-rca-combo')).toBe(src); // already fitted elsewhere: refused
  const added = addMasterModule(removeMasterModule(src, 'out-booth'), 'out-booth');
  expect(added.layout!.placements['master:out-booth']?.face).toBe('rear');
});

test('rear mirroring is its own inverse and slots know their strip', () => {
  const src = EXAMPLES['mixer-6ch']!;
  expect(flipRear(flipRear(src)).layout!.placements).toEqual(src.layout!.placements);
  const p = src.layout!.placements['ch3-io']!;
  expect(flipRear(src).layout!.placements['ch3-io']!.y).toBeCloseTo(src.layout!.panel.height - p.y, 1);
  expect(ownerOfSlot(src, 'ch3-io')!.id).toBe('ch3');
  expect(ownerOfSlot(src, 'master:out-xlr-pair')!.id).toBe('master');
});

test('proven board: capacity from the modules, overflow channels dropped with their strips', () => {
  const src = EXAMPLES['mixer-6ch']!;
  expect(boardUse(src)!.over).toBe(false); // 4 x 2 + 1 + 2 = 11 of 12 inputs
  const onProven = setBoard(src, 'teensy41-cs42448');
  const use = boardUse(onProven)!;
  expect(use.over).toBe(true);
  expect(use.overflow.length).toBeGreaterThan(0);
  const fit = fitBoard(src, 'teensy41-cs42448');
  expect(boardUse(fit)!.over).toBe(false);
  expect(fit.audio!.channels.length).toBe(use.channels - use.overflow.length);
  for (const id of use.overflow) {
    expect(fit.groups!.some((g) => g.id === id)).toBe(false);
    expect(fit.ioSlots!.some((x) => x.id === `${id}-io`)).toBe(false);
    expect(fit.layout!.placements[`${id}-io`]).toBeUndefined();
  }
  expect(fit.controls.some((c) => c.id === 'ch6-gain')).toBe(false);
});

test('duplicateStrip on an audio mixer gives the copy its own slot and channel, behind it', () => {
  const src = EXAMPLES['mixer-3ch']!;
  const next = duplicateStrip(src, 'ch3', 1);
  const copy = next.groups!.find((g) => g.id === 'ch4')!;
  expect(copy).toBeDefined();
  expect(next.ioSlots!.find((x) => x.id === 'ch4-io')!.module).toBe(src.ioSlots!.find((x) => x.id === 'ch3-io')!.module);
  expect(next.audio!.channels.find((c) => c.id === 'ch4')!.bind.fader).toBe('ch4-fader');
  const slotX = next.layout!.placements['ch4-io']!.x;
  expect(Math.abs(slotX - next.layout!.placements['ch4-fader']!.x)).toBeLessThan(20); // under its strip
  expect(validateLayout(next).filter((i) => i.severity === 'error')).toEqual([]);
});

test('describeSwap says what a swap did, with codec use and the A/B consequence', () => {
  const src = EXAMPLES['mixer-6ch']!;
  const next = swapModule(src, 'ch1-io', 'io-dual-xlr'); // ch1 has an A/B button; XLR modules have one input set
  const d = describeSwap(src, next)!;
  expect(d.id).toBe('ch1-io');
  expect(d.text).toContain('Ch 1 now takes');
  expect(d.text).toMatch(/\d+ of 12 codec inputs in use/);
  if (src.audio!.channels.find((c) => c.id === 'ch1')!.bind.inputSelect) expect(d.text).toContain('A/B button now does nothing');
  expect(describeSwap(src, src)).toBeUndefined();
  const m = swapMasterModule(removeMasterModule(src, 'out-booth'), 'out-xlr-pair', 'out-booth');
  expect(describeSwap(removeMasterModule(src, 'out-booth'), m)!.id).toBe('master:out-booth');
});

test('mergeIssues: empty design has nothing to check; repeats and screw-hole ids are cleaned up', () => {
  const lay = [{ severity: 'error', message: 'Hole sticks out', controlId: 'ch1-io#h0' }, { severity: 'error', message: 'Hole sticks out', controlId: 'ch1-io#h1' }] as const;
  expect(mergeIssues(0, [{ severity: 'info', message: 'Scan needs 0 µs' }], [...lay], [])).toEqual([]);
  const out = mergeIssues(3, [{ severity: 'info', message: 'Scan needs 5 µs' }], [...lay], []);
  expect(out.map((i) => i.controlId)).toEqual([undefined, 'ch1-io']); // the same message twice shows once, pointing at the part
  expect(mergeIssues(3, [{ severity: 'error', message: 'Hole sticks out' }], [...lay], []).length).toBe(1); // already known to App
});
