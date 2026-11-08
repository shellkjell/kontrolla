// Printable parts as three.js geometry. Shape coordinates are panel mm (x right, y towards the player).
import * as THREE from 'three';
import type { Cutout, Layout } from '@kontrolla/core';

type PathLike = THREE.Path;
type Panel = Layout['panel'];

/** Rounded rectangle outline (r = 0 gives a plain rectangle). Works for Shape and Path. */
export function roundedRect(p: PathLike, x: number, y: number, w: number, h: number, r: number): void {
  if (r < 0.01) {
    p.moveTo(x, y);
    p.lineTo(x + w, y);
    p.lineTo(x + w, y + h);
    p.lineTo(x, y + h);
    p.closePath();
    return;
  }
  const H = Math.PI / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.absarc(x + w - r, y + r, r, -H, 0, false);
  p.lineTo(x + w, y + h - r);
  p.absarc(x + w - r, y + h - r, r, 0, H, false);
  p.lineTo(x + r, y + h);
  p.absarc(x + r, y + h - r, r, H, Math.PI, false);
  p.lineTo(x, y + r);
  p.absarc(x + r, y + r, r, Math.PI, 3 * H, false);
}

const extrude = (shape: THREE.Shape, depth: number) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 16 });

/** Drop of the sloping top panel in mm (0 for a flat enclosure). */
export const dropOf = (panel: Panel) => (panel.frontHeight === undefined ? 0 : Math.max(0, panel.height - panel.frontHeight));
/** Slope angle of the top panel (radians). panel.depth is measured along the slope. */
export const slopeAngle = (panel: Panel) => Math.asin(Math.min(1, dropOf(panel) / panel.depth));
/** Depth of the walls and bottom plate seen from above. */
export const planDepth = (panel: Panel) => Math.sqrt(panel.depth ** 2 - dropOf(panel) ** 2);

function addHole(s: THREE.Shape, c: Cutout, y: number): void {
  const h = new THREE.Path();
  if (c.shape === 'circle') h.absarc(c.x, y, c.d! / 2, 0, Math.PI * 2, false);
  else roundedRect(h, c.x - c.w! / 2, y - c.h! / 2, c.w!, c.h!, c.shape === 'slot' ? Math.min(c.w!, c.h!) / 2 : 0);
  s.holes.push(h);
}

/** Top panel with a hole per cutout. Extruded along +z by thickness. flipY mirrors y (STL: y up = away from the player). */
export function topPanelGeometry(panel: Panel, cutouts: Cutout[], flipY = false): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  roundedRect(s, 0, 0, panel.width, panel.depth, panel.cornerRadius);
  for (const c of cutouts) addHole(s, c, flipY ? panel.depth - c.y : c.y);
  return extrude(s, panel.thickness);
}

/** Walls: a C-shaped ring open at the rear (the rear plate closes it), thickness = panel thickness. Height at the rear = enclosure
 *  height minus the two plates; with a wedge the top edge slopes down to the front. Extruded along +z from the TOP edge (z = 0)
 *  down, so z grows downwards. */
export function wallsGeometry(panel: Panel): THREE.ExtrudeGeometry {
  const { width: W, thickness: t, cornerRadius: r } = panel;
  const D = planDepth(panel);
  const ri = Math.max(r - t, 0);
  const A = Math.PI / 2;
  const s = new THREE.Shape();
  s.moveTo(r, 0);
  s.absarc(r, r, r, 3 * A, Math.PI, true);
  s.lineTo(0, D - r);
  s.absarc(r, D - r, r, Math.PI, A, true);
  s.lineTo(W - r, D);
  s.absarc(W - r, D - r, r, A, 0, true);
  s.lineTo(W, r);
  s.absarc(W - r, r, r, 0, -A, true);
  s.lineTo(W - r, t); // notch: the rear plate sits between the two rear corners
  if (W - t - ri < W - r - 1e-6) s.lineTo(W - t - ri, t);
  s.absarc(W - t - ri, t + ri, ri, -A, 0, false);
  s.lineTo(W - t, D - t - ri);
  s.absarc(W - t - ri, D - t - ri, ri, 0, A, false);
  s.lineTo(t + ri, D - t);
  s.absarc(t + ri, D - t - ri, ri, A, Math.PI, false);
  s.lineTo(t, t + ri);
  s.absarc(t + ri, t + ri, ri, Math.PI, 3 * A, false);
  if (t + ri < r - 1e-6) s.lineTo(r, t);
  s.closePath();
  const g = extrude(s, panel.height - 2 * t);
  const drop = dropOf(panel);
  if (drop > 0) {
    // slope the top edge: top vertices (z = 0) move down in proportion to their distance from the rear
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 1e-6) pos.setZ(i, (drop * pos.getY(i)) / D);
    g.computeVertexNormals();
  }
  return g;
}

/** Rear wall plate between the two rear corners, with the rear cutouts (y up from the bottom of the enclosure). Extruded along +z. */
export function rearPlateGeometry(panel: Panel, cutouts: Cutout[]): THREE.ExtrudeGeometry {
  const t = panel.thickness;
  const s = new THREE.Shape();
  roundedRect(s, panel.cornerRadius, 0, panel.width - 2 * panel.cornerRadius, panel.height - 2 * t, 0);
  for (const c of cutouts) addHole(s, c, c.y - t);
  return extrude(s, t);
}

export function bottomGeometry(panel: Panel): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  roundedRect(s, 0, 0, panel.width, planDepth(panel), panel.cornerRadius);
  return extrude(s, panel.thickness);
}
