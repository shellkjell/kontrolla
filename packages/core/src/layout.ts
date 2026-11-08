// Physical layout: footprints -> geometry, automatic placement, and layout checks. All lengths in mm.
import { MCUS, PARTS } from './catalog';
import type { Footprint, Part } from './catalog';
import type { DeviceSpec, Layout, Placement } from './types';
import type { Issue } from './validate';

export const MARGIN = 12;
export const EDGE_MIN = 3; // a cutout closer than this to the panel edge is too fragile
export const GROUP_PAD = 3;
const GUTTER = 8; // between blocks (strips / sections)
const ROW_MAX = 6; // items per row in a section without strips

export type GeoKind = 'pot' | 'fader' | 'button' | 'encoder' | 'meter' | 'port';
const STRIP_MIN_W = 22; // a strip is never narrower than this (plus the gutter: ~30 mm pitch)
const NUMBER_ROOM = 5; // extra top margin when strips carry a big channel number
const WEDGE_DEG = 5; // slope of the top panel on long enclosures

/** Absolute panel hole. circle: d. slot/rect: w (x extent) x h (y extent) after rotation. slot has rounded ends. */
export interface Cutout {
  id: string;
  face: 'top' | 'rear';
  shape: 'circle' | 'slot' | 'rect';
  x: number;
  y: number;
  d?: number;
  w?: number;
  h?: number;
}

/** Size of one control as placed (rotation applied). */
interface Geo {
  id: string;
  label: string;
  kind: GeoKind;
  part: Part;
  fp: Footprint;
  w: number; // occupancy: what its cap can sweep over
  h: number;
  round: boolean; // occupancy is a circle (w == h == d)
  capSize: number; // finger-visible width
  cut: { shape: Cutout['shape']; w: number; h: number }; // d in w for circles
  rot: Placement['rotation'];
  face: 'top' | 'rear';
}

const swap = (r: Placement['rotation']) => r === 90 || r === 270;

/** Things that need a hole but are not controls: the USB opening and the MIDI jack, both on the rear wall. */
const virtualParts = (spec: DeviceSpec): Record<string, { part: string; label: string }> => ({
  usb: { part: 'usb-micro-b', label: 'USB opening' },
  ...(spec.midiPort ? { 'midi-port': { part: spec.midiPort.part, label: 'MIDI jack' } } : {}),
});

function geoOf(spec: DeviceSpec, id: string, rot: Placement['rotation'] = 0, face?: Placement['face']): Geo | undefined {
  const c = spec.controls.find((x) => x.id === id);
  const m = c ? undefined : spec.meters?.find((x) => x.id === id);
  const v = c || m ? undefined : virtualParts(spec)[id];
  const part = PARTS[(c ?? m)?.part ?? v?.part ?? ''];
  const fp = part?.footprint;
  if (!part || !fp) return undefined;
  const kind: GeoKind = c ? c.kind : m ? 'meter' : 'port';
  const label = (c ?? m)?.label ?? v?.label ?? id;
  const cap = fp.cap;
  let w = cap.shape === 'circle' ? cap.d : cap.w;
  let h = cap.shape === 'circle' ? cap.d : cap.h;
  let cut: Geo['cut'];
  const co = fp.cutout;
  if (co.shape === 'circle') cut = { shape: 'circle', w: co.d, h: co.d };
  else if (co.shape === 'slot') cut = { shape: 'slot', w: co.w, h: co.l };
  else cut = { shape: 'rect', w: co.w, h: co.h };
  if (m) {
    const len = m.ledCount * (fp.segmentPitch ?? 5);
    h = len;
    cut = { shape: 'rect', w: co.shape === 'rect' ? co.w : 4.5, h: len - 0.5 };
  } else if (co.shape === 'slot') h = co.l - 2 + (cap.shape === 'circle' ? cap.d : cap.h); // cap centre travels slot length - 2
  const round = !m && cap.shape === 'circle' && co.shape === 'circle';
  const capSize = cap.shape === 'circle' ? cap.d : Math.min(cap.w, cap.h);
  if (swap(rot)) {
    [w, h] = [h, w];
    cut = { ...cut, w: cut.h, h: cut.w };
  }
  return { id, label, kind, part, fp, w, h, round, capSize, cut, rot, face: face ?? (fp.face === 'rear' ? 'rear' : 'top') };
}

const allIds = (spec: DeviceSpec) => [...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id), ...Object.keys(virtualParts(spec))];

function geos(spec: DeviceSpec): Geo[] {
  return allIds(spec).flatMap((id) => {
    const p = spec.layout?.placements[id];
    const g = geoOf(spec, id, p?.rotation ?? 0, p?.face);
    return g ? [g] : [];
  });
}

/** Holes for every placed control/meter/port on one face, in absolute mm (top: panel x/y; rear: x along the width, y up from the bottom of the rear wall). */
export function cutoutsOf(spec: DeviceSpec, face: 'top' | 'rear' = 'top'): Cutout[] {
  const out: Cutout[] = [];
  for (const g of geos(spec)) {
    const p = spec.layout?.placements[g.id];
    if (!p || g.face !== face) continue;
    if (g.cut.shape === 'circle') out.push({ id: g.id, face, shape: 'circle', x: p.x, y: p.y, d: g.cut.w });
    else out.push({ id: g.id, face, shape: g.cut.shape, x: p.x, y: p.y, w: g.cut.w, h: g.cut.h });
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Occupancy box (cap sweep) of a placed control/meter, top-left origin. */
export function boxOf(spec: DeviceSpec, id: string): Box | undefined {
  const p = spec.layout?.placements[id];
  const g = p && geoOf(spec, id, p.rotation ?? 0, p.face);
  return p && g ? { x: p.x - g.w / 2, y: p.y - g.h / 2, w: g.w, h: g.h } : undefined;
}

/** Bounding box of a group's placed members, grown by pad. */
export function groupBBox(spec: DeviceSpec, groupId: string, pad = 0): Box | undefined {
  const g = spec.groups?.find((x) => x.id === groupId);
  const boxes = (g?.members ?? []).flatMap((id) => boxOf(spec, id) ?? []);
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Required free gap between two caps so fingers fit: pitch minus cap size, at least 2 mm. */
const clearance = (a: Geo, b: Geo) => Math.max(2, (a.fp.minPitch + b.fp.minPitch) / 2 - (a.capSize + b.capSize) / 2);

/** Distance between occupancy shapes at the given centres; negative = overlapping. */
function gap(a: Geo, ax: number, ay: number, b: Geo, bx: number, by: number): number {
  if (a.round && b.round) return Math.hypot(ax - bx, ay - by) - a.w / 2 - b.w / 2;
  if (!a.round && !b.round) {
    const dx = Math.abs(ax - bx) - (a.w + b.w) / 2;
    const dy = Math.abs(ay - by) - (a.h + b.h) / 2;
    return dx < 0 && dy < 0 ? Math.max(dx, dy) : Math.hypot(Math.max(0, dx), Math.max(0, dy));
  }
  const [c, cx, cy, r, rx, ry] = a.round ? [a, ax, ay, b, bx, by] : [b, bx, by, a, ax, ay];
  const dx = Math.max(0, Math.abs(cx - rx) - r.w / 2);
  const dy = Math.max(0, Math.abs(cy - ry) - r.h / 2);
  if (dx === 0 && dy === 0) return -c.w / 2;
  return Math.hypot(dx, dy) - c.w / 2;
}

const kindRank = (k: GeoKind) => (k === 'pot' || k === 'encoder' ? 0 : k === 'button' ? 1 : k === 'meter' ? 2 : k === 'fader' ? 3 : 4);

interface Block {
  items: Geo[];
  w: number;
  h: number;
  pos: Map<string, { x: number; y: number }>; // centres relative to block top-left
}

const rowGap = (a: Geo[], b: Geo[]) => Math.max(...a.flatMap((x) => b.map((y) => clearance(x, y))));

/** Rows stacked top to bottom, each row centred; items inside a row sit side by side. */
function stack(rows: Geo[][], minW = 0): Block {
  const pos = new Map<string, { x: number; y: number }>();
  const rw = rows.map((r) => r.reduce((sum, it, k) => sum + it.w + (k ? clearance(r[k - 1]!, it) : 0), 0));
  const w = Math.max(minW, ...rw);
  let y = 0;
  rows.forEach((row, ri) => {
    const rh = Math.max(...row.map((i) => i.h));
    let x = (w - rw[ri]!) / 2;
    row.forEach((it, k) => {
      if (k) x += clearance(row[k - 1]!, it);
      pos.set(it.id, { x: x + it.w / 2, y: y + rh / 2 });
      x += it.w;
    });
    y += rh + (rows[ri + 1] ? rowGap(row, rows[ri + 1]!) : 0);
  });
  return { items: rows.flat(), w, h: y, pos };
}

/** Meters share a row, a fader joins the meters before it (the meter sits BESIDE the fader like on a real mixer),
 *  and with buttonsPerRow buttons pair up (strips: two narrow rows of two). Everything else gets its own row. */
const toRows = (items: Geo[], buttonsPerRow = 1): Geo[][] =>
  items.reduce<Geo[][]>((rows, it) => {
    const last = rows[rows.length - 1];
    const kind = last?.[0]?.kind;
    if (last && it.kind === 'meter' && kind === 'meter' && !last.some((g) => g.kind === 'fader')) last.push(it);
    else if (last && it.kind === 'fader' && kind === 'meter' && !last.some((g) => g.kind === 'fader')) last.push(it);
    else if (last && it.kind === 'button' && kind === 'button' && last.length < buttonsPerRow) last.push(it);
    else rows.push([it]);
    return rows;
  }, []);

/** Sections: wrapped columns of at most maxH (when strips set the height), else rows of one kind, up to ROW_MAX each. */
function flow(items: Geo[], maxH: number | undefined): Block {
  const pos = new Map<string, { x: number; y: number }>();
  if (maxH !== undefined) {
    const cols: Geo[][][] = [[]];
    let y = 0;
    for (const row of toRows(items)) {
      const col = cols[cols.length - 1]!;
      const prev = col[col.length - 1];
      const rh = Math.max(...row.map((i) => i.h));
      const step = prev ? rowGap(prev, row) : 0;
      if (prev && y + step + rh > maxH) (cols.push([row]), (y = rh));
      else (col.push(row), (y += step + rh));
    }
    let x = 0;
    let h = 0;
    for (const col of cols) {
      const b = stack(col);
      b.pos.forEach((p, id) => pos.set(id, { x: x + p.x, y: p.y }));
      x += b.w + GUTTER;
      h = Math.max(h, b.h);
    }
    return { items, w: Math.max(0, x - GUTTER), h, pos };
  }
  const rows: Geo[][] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && row.length < ROW_MAX && kindRank(row[0]!.kind) === kindRank(it.kind)) row.push(it);
    else rows.push([it]);
  }
  let y = 0;
  let w = 0;
  for (const row of rows) {
    const rh = Math.max(...row.map((i) => i.h));
    let x = 0;
    row.forEach((it, i) => {
      pos.set(it.id, { x: x + it.w / 2, y: y + rh / 2 });
      x += it.w + (row[i + 1] ? clearance(it, row[i + 1]!) : 0);
    });
    w = Math.max(w, x);
    y += rh + 2 * GUTTER - 4; // room for the next group's label
  }
  return { items, w, h: Math.max(0, y - (2 * GUTTER - 4)), pos };
}

const REAR_Y: Record<string, number> = { usb: 7.5, 'midi-port': 12 }; // above the bottom plate: USB lines up with the board's connector

/** Left to right along the rear wall, starting at x0. Cutout y is measured up from the bottom edge of the rear wall. */
function placeRear(items: Geo[], x0: number, thickness: number, out: Layout['placements']): void {
  let x = x0;
  for (const g of items) {
    const y = thickness + (g.round && g.w > 15 ? 11 : (REAR_Y[g.id] ?? 12));
    out[g.id] = { x: x + g.w / 2, y, face: 'rear' };
    x += g.w + 12;
  }
}

/** Strips become columns left to right (pots/encoders, buttons in pairs, meter beside the fader nearest the player);
 *  everything else forms sections to the right. Strips get a big number on the panel. Rear parts (USB, MIDI jack) go on the rear wall.
 *  Long panels slope down towards the player (wedge). */
export function autoLayout(spec: DeviceSpec): Layout {
  const all = new Map(geos({ ...spec, layout: undefined }).map((g) => [g.id, g]));
  const rear = [...all.values()].filter((g) => g.face === 'rear');
  for (const g of rear) all.delete(g.id);
  const claimed = new Set<string>();
  const sorted = (ids: string[]) => ids.flatMap((id) => all.get(id) ?? []).sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  const groups = (spec.groups ?? []).map((g) => ({ g, items: sorted(g.members.filter((id) => !claimed.has(id) && claimed.add(id))) }));
  const strips = groups.filter((x) => x.g.kind === 'strip' && x.items.length);
  const rest = groups.filter((x) => x.g.kind !== 'strip' && x.items.length).map((x) => x.items);
  const loose = sorted([...all.keys()].filter((id) => !claimed.has(id)));
  if (loose.length) rest.push(loose);

  const placements: Layout['placements'] = {};
  const place = (b: Block, ox: number, oy: number) => b.pos.forEach((p, id) => (placements[id] = { x: ox + p.x, y: oy + p.y }));
  let width = 0;
  let depth = 0;
  const sBlocks = strips.map((s) => stack(toRows(s.items, 2), STRIP_MIN_W));
  let x = 0;
  const stripX: number[] = [];
  for (const b of sBlocks) {
    stripX.push(x + b.w / 2);
    place(b, x, 0);
    x += b.w + GUTTER;
    depth = Math.max(depth, b.h);
  }
  width = Math.max(0, x - GUTTER);

  const maxH = sBlocks.length ? depth : undefined;
  const rBlocks = rest.map((items) => flow(items, maxH));
  if (maxH !== undefined) {
    let rx = width + (rBlocks.length ? GUTTER : 0);
    for (const b of rBlocks) {
      place(b, rx, 0);
      rx += b.w + GUTTER;
      depth = Math.max(depth, b.h);
    }
    width = Math.max(width, rx - GUTTER);
  } else {
    let ry = 0;
    for (const b of rBlocks) {
      place(b, 0, ry);
      ry += b.h + 2 * GUTTER - 4; // room for the next group's label
      width = Math.max(width, b.w);
    }
    depth = Math.max(0, ry - (2 * GUTTER - 4));
  }

  const top = MARGIN + (strips.length ? NUMBER_ROOM : 0);
  for (const p of Object.values(placements)) ((p.x += MARGIN), (p.y += top));
  const thickness = 3;
  const annotations = (spec.layout?.annotations ?? []).filter((a) => !a.id.startsWith('num-'));
  strips.forEach(({ g }, i) => {
    const text = g.label.match(/\d+/g)?.pop() ?? String(i + 1);
    const size = 8;
    annotations.push({ id: `num-${g.id}`, kind: 'text', x: Math.round((MARGIN + stripX[i]! - 0.3 * size * text.length) * 10) / 10, y: top - GROUP_PAD - 4.5, text, size });
  });

  const panelDepth = Math.ceil(depth + top + MARGIN);
  const panelWidth = Math.ceil(width + 2 * MARGIN);
  const items = [...all.values()];
  const maxBody = Math.max(0, ...items.map((g) => g.fp.bodyDepth));
  const boardH = MCUS[spec.mcu].board.height;
  let height = Math.ceil(2 * thickness + maxBody + boardH);
  let frontHeight: number | undefined;
  const drop = Math.min(30, Math.round(panelDepth * Math.sin((WEDGE_DEG * Math.PI) / 180)));
  if (drop >= 3) {
    // every part must clear the underside of the sloping panel: room(s) = height - 2t - drop * s / depth
    const need = Math.max(2 * thickness + 15, ...items.map((g) => 2 * thickness + g.fp.bodyDepth + 3 + (drop * placements[g.id]!.y) / panelDepth));
    height = Math.ceil(need);
    frontHeight = height - drop;
  }
  placeRear(rear, MARGIN + 5, thickness, placements);
  return {
    panel: { width: Math.max(panelWidth, Math.ceil(MARGIN + 5 + rear.reduce((n, g) => n + g.w + 12, 0) + MARGIN - 12)), depth: panelDepth, height, ...(frontHeight !== undefined && { frontHeight }), thickness, cornerRadius: 4 },
    placements,
    annotations,
  };
}

/** Fill only the missing placements: new top-face items go in rows below everything already placed; the panel grows to fit. */
export function ensureLayout(spec: DeviceSpec): DeviceSpec {
  if (!spec.layout) return { ...structuredClone(spec), layout: autoLayout(spec) };
  const out = structuredClone(spec);
  const lay = out.layout!;
  const missing = geos(out).filter((g) => !lay.placements[g.id]);
  if (!missing.length) return out;
  const missTop = missing.filter((g) => g.face === 'top').sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  const placed = geos(out).filter((g) => lay.placements[g.id]);
  if (missTop.length) {
    const bottom = Math.max(MARGIN - GUTTER, ...placed.filter((g) => g.face === 'top').map((g) => lay.placements[g.id]!.y + g.h / 2));
    const b = flow(missTop, undefined);
    b.pos.forEach((p, id) => (lay.placements[id] = { x: MARGIN + p.x, y: bottom + GUTTER + p.y }));
    lay.panel.width = Math.max(lay.panel.width, Math.ceil(MARGIN * 2 + b.w));
    lay.panel.depth = Math.max(lay.panel.depth, Math.ceil(bottom + GUTTER + b.h + MARGIN));
    const body = Math.max(...missTop.map((g) => g.fp.bodyDepth));
    lay.panel.height = Math.max(lay.panel.height, Math.ceil(2 * lay.panel.thickness + body + MCUS[out.mcu].board.height + (lay.panel.height - (lay.panel.frontHeight ?? lay.panel.height))));
  }
  const missRear = missing.filter((g) => g.face === 'rear');
  if (missRear.length) {
    const right = Math.max(MARGIN - 7, ...placed.filter((g) => g.face === 'rear').map((g) => lay.placements[g.id]!.x + g.w / 2 + 12));
    placeRear(missRear, right, lay.panel.thickness, lay.placements);
    lay.panel.width = Math.max(lay.panel.width, Math.ceil(Math.max(...missRear.map((g) => lay.placements[g.id]!.x + g.w / 2)) + MARGIN));
  }
  return out;
}

const KIND_NOUN: Record<GeoKind, string> = { pot: 'Knobs', encoder: 'Knobs', button: 'Buttons', fader: 'Faders', meter: 'Meters', port: 'Openings' };

export function validateLayout(spec: DeviceSpec): Issue[] {
  const out: Issue[] = [];
  const add = (severity: Issue['severity'], message: string, controlId?: string, fix?: string) =>
    out.push({ severity, message, ...(controlId !== undefined && { controlId }), ...(fix !== undefined && { fix }) });
  const lay = spec.layout;
  const all = geos(spec);
  if (!lay) return all.length ? [{ severity: 'info', message: 'No panel layout yet', fix: 'Run autoLayout' }] : [];

  const placed = all.filter((g) => lay.placements[g.id]);
  for (const g of all)
    if (!lay.placements[g.id]) add('info', `${g.label} is not placed on the panel yet`, g.id, 'Drag it onto the panel or run ensureLayout');

  const at = (g: Geo) => lay.placements[g.id]!;
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (a.face !== b.face) continue;
      const d = gap(a, at(a).x, at(a).y, b, at(b).x, at(b).y);
      if (d < -1e-6)
        add('error', `${a.label} and ${b.label} overlap on the ${a.face === 'rear' ? 'rear wall' : 'panel'}`, a.id, 'Move one of them apart');
      else {
        const need = clearance(a, b);
        if (d < need - 0.01) {
          const noun = a.kind === b.kind || KIND_NOUN[a.kind] === KIND_NOUN[b.kind] ? KIND_NOUN[a.kind] : 'Controls';
          add('warning', `${noun} closer than ${Math.round((a.fp.minPitch + b.fp.minPitch) / 2)} mm are hard to ${noun === 'Buttons' ? 'press' : noun === 'Knobs' ? 'turn' : 'use'} without bumping neighbours (${a.label} / ${b.label})`, a.id, `Leave at least ${need.toFixed(0)} mm between their edges`);
        }
      }
    }

  const { width, depth, height, thickness, frontHeight } = lay.panel;
  const drop = frontHeight === undefined ? 0 : height - frontHeight;
  if (drop > 0 && drop >= depth) add('error', `The slope drops ${drop} mm but the panel is only ${depth} mm deep`, undefined, 'Make the panel deeper or the front taller');
  const checkEdge = (face: 'top' | 'rear') => {
    // top: the whole panel; rear: the wall between the two plates
    const [x0, x1, y0, y1] = face === 'top' ? [0, width, 0, depth] : [0, width, thickness + 2, height - thickness - 2];
    const where = face === 'top' ? 'panel' : 'rear wall';
    for (const c of cutoutsOf(spec, face)) {
      const g = placed.find((x) => x.id === c.id)!;
      const hw = (c.d ?? c.w!) / 2;
      const hh = (c.d ?? c.h!) / 2;
      const m = Math.min(c.x - hw - x0, x1 - (c.x + hw), c.y - hh - y0, y1 - (c.y + hh));
      if (m < 0) add('error', `${g.label}'s hole sticks out past the edge of the ${where}`, c.id, `Move it inside the ${where}${face === 'top' ? ' or make the panel bigger' : ''}`);
      else if (face === 'top' && m < EDGE_MIN)
        add('error', `${g.label}'s hole is less than ${EDGE_MIN} mm from the panel edge; the panel would crack or print thin`, c.id, 'Move it inward or make the panel bigger');
      else if (face === 'rear' && Math.min(c.x - hw - x0, x1 - (c.x + hw)) < EDGE_MIN)
        add('error', `${g.label}'s hole is less than ${EDGE_MIN} mm from the corner of the rear wall`, c.id, 'Move it inward');
    }
  };
  checkEdge('top');
  checkEdge('rear');

  for (const g of placed) {
    if (g.face !== 'top') continue;
    const room = height - 2 * thickness - (drop * at(g).y) / depth;
    if (g.fp.bodyDepth > room) add('warning', `${g.label} is ${g.fp.bodyDepth} mm deep but the enclosure only has ${Math.floor(room)} mm inside at that spot`, g.id, 'Make the enclosure taller');
  }

  for (const grp of spec.groups ?? []) {
    const m = grp.members.flatMap((id) => placed.find((g) => g.id === id) ?? []);
    if (m.length < 2) continue;
    // connected components: members within 25 mm of each other belong together
    const comp = m.map((_, i) => i);
    const root = (i: number): number => (comp[i] === i ? i : (comp[i] = root(comp[i]!)));
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++)
        if (gap(m[i]!, at(m[i]!).x, at(m[i]!).y, m[j]!, at(m[j]!).x, at(m[j]!).y) <= 25) comp[root(i)] = root(j);
    if (new Set(m.map((_, i) => root(i))).size > 1) add('info', `Group "${grp.label}" is spread over the panel; its members are not next to each other`, grp.members[0]);
  }
  return out;
}
