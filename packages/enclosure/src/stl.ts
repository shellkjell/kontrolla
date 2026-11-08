import type * as THREE from 'three';
import { cutoutsOf, ensureLayout } from '@kontrolla/core';
import type { DeviceSpec } from '@kontrolla/core';
import { bottomGeometry, topPanelGeometry, wallsGeometry } from './geometry';

/** Binary STL of the printable parts (top panel with holes, wall ring, bottom plate), each flat on the bed, side by side
 *  along x with a 10 mm gap, ready to be split in the slicer. Top panel is printed face-up. No knobs or caps. */
export function exportStl(input: DeviceSpec): Uint8Array {
  const spec = ensureLayout(input);
  const panel = spec.layout!.panel;
  const parts: [THREE.BufferGeometry, number][] = [
    [topPanelGeometry(panel, cutoutsOf(spec), true), 0],
    [wallsGeometry(panel), panel.width + 10],
    [bottomGeometry(panel), 2 * (panel.width + 10)],
  ];
  const tris = parts.map(([g]) => g.getAttribute('position').count / 3);
  const buf = new ArrayBuffer(84 + 50 * tris.reduce((a, b) => a + b, 0));
  const dv = new DataView(buf);
  new TextEncoder().encodeInto('kont.rolla enclosure', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, tris.reduce((a, b) => a + b, 0), true);
  let o = 84;
  parts.forEach(([g, dx]) => {
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
