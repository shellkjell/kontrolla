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
