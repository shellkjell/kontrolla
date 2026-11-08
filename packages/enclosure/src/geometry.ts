// Printable parts as three.js geometry. Shape coordinates are panel mm (x right, y towards the player).
import * as THREE from 'three';
import type { Cutout, Layout } from '@kontrolla/core';

type PathLike = THREE.Path;

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

/** Top panel with a hole per cutout. Extruded along +z by thickness. flipY mirrors y (STL: y up = away from the player). */
export function topPanelGeometry(panel: Layout['panel'], cutouts: Cutout[], flipY = false): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  roundedRect(s, 0, 0, panel.width, panel.depth, panel.cornerRadius);
  for (const c of cutouts) {
    const h = new THREE.Path();
    const y = flipY ? panel.depth - c.y : c.y;
    if (c.shape === 'circle') h.absarc(c.x, y, c.d! / 2, 0, Math.PI * 2, false);
    else roundedRect(h, c.x - c.w! / 2, y - c.h! / 2, c.w!, c.h!, c.shape === 'slot' ? Math.min(c.w!, c.h!) / 2 : 0);
    s.holes.push(h);
  }
  return extrude(s, panel.thickness);
}

/** Wall ring, wall thickness = panel thickness, height = enclosure height minus the two plates. */
export function wallsGeometry(panel: Layout['panel']): THREE.ExtrudeGeometry {
  const t = panel.thickness;
  const s = new THREE.Shape();
  roundedRect(s, 0, 0, panel.width, panel.depth, panel.cornerRadius);
  const hole = new THREE.Path();
  roundedRect(hole, t, t, panel.width - 2 * t, panel.depth - 2 * t, Math.max(panel.cornerRadius - t, 0));
  s.holes.push(hole);
  return extrude(s, panel.height - 2 * t);
}

export function bottomGeometry(panel: Layout['panel']): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  roundedRect(s, 0, 0, panel.width, panel.depth, panel.cornerRadius);
  return extrude(s, panel.thickness);
}
