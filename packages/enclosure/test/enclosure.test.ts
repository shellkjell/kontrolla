import { expect, test } from 'bun:test';
import { EXAMPLES, allocatePins, cutoutsOf } from '@kontrolla/core';
import { buildEnclosure, drillTemplateSvg, exportStl, setControlValue, setLeds } from '../src';

const spec = allocatePins(EXAMPLES['mixer-6ch']!);

test('exportStl is a valid binary STL', () => {
  const stl = exportStl(spec);
  const n = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
  expect(n).toBeGreaterThan(1000);
  expect(stl.length).toBe(84 + 50 * n);
});

test('drillTemplateSvg: true scale and a circle per round cutout', () => {
  const svg = drillTemplateSvg(spec);
  const p = spec.layout!.panel;
  expect(svg).toContain(`width="${p.width}mm"`);
  expect(svg).toContain(`height="${p.depth}mm"`);
  const round = cutoutsOf(spec).filter((c) => c.shape === 'circle').length;
  expect(round).toBeGreaterThan(30);
  expect(svg.match(/<circle /g)!.length).toBe(round);
});

test('buildEnclosure names objects by control id; live updates', () => {
  const g = buildEnclosure(spec, { exploded: 0.5 });
  for (const id of ['ch1-gain', 'ch3-fader', 'ch2-mute', 'ch1-meter', 'master-fader']) expect(g.getObjectByName(id), id).toBeDefined();
  setControlValue(g, spec, 'ch1-gain', 1);
  expect(g.getObjectByName('ch1-gain/knob')!.rotation.y).toBeLessThan(0);
  const before = g.getObjectByName('ch1-fader/cap')!.position.z;
  setControlValue(g, spec, 'ch1-fader', 1);
  expect(g.getObjectByName('ch1-fader/cap')!.position.z).toBeLessThan(before);
  const rgb = new Uint8Array(spec.leds!.count * 3);
  rgb[0] = 16;
  setLeds(g, spec, rgb);
  const mute = spec.controls.find((c) => c.id === 'ch1-mute')!;
  expect(mute.kind === 'button' && mute.led!.index).toBeDefined();
});

test('every path point and rect in the drill SVG stays inside the panel', () => {
  for (const [name, ex] of Object.entries(EXAMPLES)) {
    const s = allocatePins(ex);
    const { width: W, depth: D } = s.layout!.panel;
    const svg = drillTemplateSvg(s);
    const ok = (x: number, y: number) => x >= 0 && y >= 0 && x <= W && y <= D;
    for (const m of svg.matchAll(/<path d="([^"]+)"/g)) {
      let x = 0;
      let y = 0;
      for (const [, cmd, nums] of m[1]!.matchAll(/([MHV])([-\d. ]+)/g)) {
        const n = nums!.trim().split(/\s+/).map(Number);
        if (cmd === 'M') [x, y] = [n[0]!, n[1]!];
        else if (cmd === 'H') x = n[0]!;
        else y = n[0]!;
        expect(ok(x, y), `${name}: ${m[1]}`).toBe(true);
      }
    }
    for (const m of svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
      expect(ok(x, y) && ok(x + w, y + h), `${name}: rect ${m[0]}`).toBe(true);
    }
  }
});

test('stereo master meters sit side by side', () => {
  const p = spec.layout!.placements;
  expect(p['master-meter-l']!.y).toBe(p['master-meter-r']!.y);
  expect(p['master-meter-r']!.x).toBeGreaterThan(p['master-meter-l']!.x);
});
