// Pure 2D helpers for the layout canvas. All lengths in mm, origin top-left, +y towards the player.
import type { Placement } from '@kontrolla/core';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A dashed alignment line: at = the coordinate on `axis`, from..to = how far it runs along the other axis. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}
export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';

export const GRIDS = [0, 1, 2.5, 5] as const; // 0 = free
export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const snapTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

export const union = (rs: Rect[]): Rect | undefined => {
  if (!rs.length) return undefined;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const xs = (b: Rect) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b: Rect) => [b.y, b.y + b.h / 2, b.y + b.h];

/** Where a dragged selection lands. Neighbour edges/centres win within `threshold`; otherwise the primary item's centre snaps to the grid. */
export function snapMove(o: {
  origin: Record<string, Placement>; // dragged ids at drag start
  primary: string;
  delta: Pt;
  boxes: Map<string, Rect>; // every placed occupancy box at drag start
  step: number;
  threshold: number;
  panel: { width: number; depth: number };
}): { delta: Pt; guides: Guide[] } {
  const ids = Object.keys(o.origin);
  const mine = union(ids.flatMap((id) => o.boxes.get(id) ?? []));
  const others = [...o.boxes].filter(([id]) => !(id in o.origin)).map(([, b]) => b);
  const p0 = o.origin[o.primary]!;
  const out: Pt = { x: snapTo(p0.x + o.delta.x, o.step) - p0.x, y: snapTo(p0.y + o.delta.y, o.step) - p0.y };
  const guides: Guide[] = [];
  if (!mine) return { delta: out, guides };

  for (const axis of ['x', 'y'] as const) {
    const pick = axis === 'x' ? xs : ys;
    const moved: Rect = { ...mine, [axis]: mine[axis] + o.delta[axis] };
    const targets = [{ v: (axis === 'x' ? o.panel.width : o.panel.depth) / 2, box: undefined as Rect | undefined }, ...others.flatMap((b) => pick(b).map((v) => ({ v, box: b })))];
    let best: { d: number; v: number } | undefined;
    for (const m of pick(moved))
      for (const t of targets) {
        const d = t.v - m;
        if (Math.abs(d) <= o.threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: t.v };
      }
    if (!best) continue;
    out[axis] = o.delta[axis] + best.d;
    const final: Rect = { ...mine, [axis]: mine[axis] + out[axis] };
    const hit = others.filter((b) => pick(b).some((v) => Math.abs(v - best!.v) < 0.01));
    const span = union([final, ...hit])!;
    guides.push(axis === 'x' ? { axis, at: best.v, from: span.y - 2, to: span.y + span.h + 2 } : { axis, at: best.v, from: span.x - 2, to: span.x + span.w + 2 });
  }
  return { delta: out, guides };
}

/** New centres that line the boxes up. Box centres equal placement centres, so only the edge modes move by half a size. */
export function alignPlacements(ids: string[], boxes: Map<string, Rect>, mode: Align): Record<string, Pt> {
  const bs = ids.flatMap((id) => (boxes.has(id) ? [[id, boxes.get(id)!] as const] : []));
  const out: Record<string, Pt> = {};
  if (bs.length < 2) return out;
  const u = union(bs.map(([, b]) => b))!;
  for (const [id, b] of bs) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    out[id] = {
      left: { x: u.x + b.w / 2, y: cy },
      hcenter: { x: u.x + u.w / 2, y: cy },
      right: { x: u.x + u.w - b.w / 2, y: cy },
      top: { x: cx, y: u.y + b.h / 2 },
      vmiddle: { x: cx, y: u.y + u.h / 2 },
      bottom: { x: cx, y: u.y + u.h - b.h / 2 },
    }[mode];
  }
  return out;
}

/** Equal gaps between boxes along one axis; the two outermost stay put. Needs three or more. */
export function distributePlacements(ids: string[], boxes: Map<string, Rect>, axis: 'x' | 'y'): Record<string, Pt> {
  const size = axis === 'x' ? 'w' : 'h';
  const bs = ids.flatMap((id) => (boxes.has(id) ? [[id, boxes.get(id)!] as const] : [])).sort((a, b) => a[1][axis] + a[1][size] / 2 - (b[1][axis] + b[1][size] / 2));
  const out: Record<string, Pt> = {};
  if (bs.length < 3) return out;
  const first = bs[0]![1];
  const last = bs[bs.length - 1]![1];
  const free = last[axis] + last[size] - first[axis] - bs.reduce((s, [, b]) => s + b[size], 0);
  const gap = free / (bs.length - 1);
  let at = first[axis];
  for (const [id, b] of bs) {
    const c = at + b[size] / 2;
    out[id] = axis === 'x' ? { x: c, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: c };
    at += b[size] + gap;
  }
  return out;
}
