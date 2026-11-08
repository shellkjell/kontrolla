import type * as THREE from 'three';
import { cutoutsOf, ensureLayout } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { bottomGeometry, planDepth, rearPlateGeometry, topPanelGeometry, wallsGeometry } from './geometry';

/** Binary STL of the printable parts (top panel with holes, walls, rear plate with holes, bottom plate), each flat on the bed,
 *  side by side along x with a 10 mm gap, ready to be split in the slicer. The top panel is printed face-up; with a wedge the
 *  walls are cut to the slope. No knobs or caps. */
export function exportStl(input: DeviceSpec): Uint8Array {
  const spec = ensureLayout(input);
  const panel = spec.layout!.panel;
  const walls = wallsGeometry(panel);
  // print the walls upright: the sloped top edge up (a proper rotation, so triangle winding stays outward)
  walls.rotateX(Math.PI);
  walls.translate(0, planDepth(panel), panel.height - 2 * panel.thickness);
  const parts: THREE.BufferGeometry[] = [
    topPanelGeometry(panel, cutoutsOf(spec), true),
    walls,
    rearPlateGeometry(panel, cutoutsOf(spec, 'rear')),
    bottomGeometry(panel),
  ];
  const tris = parts.map((g) => g.getAttribute('position').count / 3);
  const total = tris.reduce((a, b) => a + b, 0);
  const buf = new ArrayBuffer(84 + 50 * total);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto('kont.rolla enclosure', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, total, true);
  let o = 84;
  parts.forEach((g, gi) => {
    const dx = gi * (panel.width + 10);
    const g2 = g.index ? g.toNonIndexed() : g;
    const pos = g2.getAttribute('position');
    for (let t = 0; t < pos.count; t += 3) {
      const v = [0, 1, 2].map((k) => [pos.getX(t + k) + dx, pos.getY(t + k), pos.getZ(t + k)] as const);
      const [a, b, c] = v as unknown as [readonly number[], readonly number[], readonly number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      n.forEach((x, i) => dv.setFloat32(o + 4 * i, x / len, true));
      v.forEach((p, k) => p.forEach((x, i) => dv.setFloat32(o + 12 + 12 * k + 4 * i, x, true)));
      o += 50;
    }
  });
  return new Uint8Array(buf);
}
