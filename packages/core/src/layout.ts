// Physical layout: footprints -> geometry, automatic placement, and layout checks. All lengths in mm.
import { IO_MODULES, MCUS, PARTS } from './catalog';
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
const MAX_COLUMN_GAP = 20; // widest gap autoLayout puts between the columns of a section
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
const virtualParts = (spec: DeviceSpec): Record<string, { part: string; label: string }> => {
  const out: Record<string, { part: string; label: string }> = { usb: { part: 'usb-micro-b', label: 'USB opening' } };
  if (spec.midiPort) out['midi-port'] = { part: spec.midiPort.part, label: 'MIDI jack' };
  for (const s of spec.ioSlots ?? []) out[s.id] = { part: 'io-slot', label: `Slot ${s.label ?? s.id}` };
  const outs = spec.audio?.master.outputs ?? [];
  for (const m of outs) if (IO_MODULES[m]?.mount === 'slot') out[`master:${m}`] = { part: 'io-slot', label: IO_MODULES[m]!.name };
  if (outs.includes('out-phones')) {
    out['phones-63'] = { part: 'phones-jack-63', label: 'Phones 6.3 mm' };
    out['phones-35'] = { part: 'phones-jack-35', label: 'Phones 3.5 mm' };
  }
  if (spec.audio) out['usb-c-power'] = { part: 'usb-c-power', label: 'USB-C power opening' };
  return out;
};

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
    // screw holes: dy points down on the drawing, i.e. towards -y on the rear (y up) and +y on the top panel
    (g.fp.holes ?? []).forEach((h, i) => out.push({ id: `${g.id}#h${i}`, face, shape: 'circle', x: p.x + h.dx, y: p.y + (face === 'rear' ? -h.dy : h.dy), d: h.d }));
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

const kindRank = (k: GeoKind) => (k === 'pot' || k === 'encoder' || k === 'port' ? 0 : k === 'button' ? 1 : k === 'meter' ? 2 : 3);

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
function flow(items: Geo[], maxH: number | undefined, gap = GUTTER, bottomH?: number, buttonY?: number): Block {
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
      // beside the strips, the column with the fader sits at the bottom, level with the channel faders
      const dy = bottomH !== undefined && cols.length > 1 && col.some((r) => r.some((g) => g.kind === 'fader')) ? Math.max(0, bottomH - b.h) : 0;
      // a button row lines up with the channel strips' button rows
      const btn = buttonY !== undefined && cols.length > 1 ? b.items.find((g) => g.kind === 'button') : undefined;
      const shift = btn ? Math.max(0, buttonY! - b.pos.get(btn.id)!.y) : 0;
      const from = btn ? b.pos.get(btn.id)!.y - 1 : Infinity;
      b.pos.forEach((p, id) => pos.set(id, { x: x + p.x, y: dy + p.y + (p.y >= from ? shift : 0) }));
      x += b.w + gap;
      h = Math.max(h, dy + b.h + shift);
    }
    return { items, w: Math.max(0, x - gap), h, pos };
  }
  // consecutive items of one kind form a grid that is as close to square as the pitches allow; kinds stack with a gap between
  const runs: Geo[][] = [];
  for (const it of items) {
    const run = runs[runs.length - 1];
    if (run && kindRank(run[0]!.kind) === kindRank(it.kind)) run.push(it);
    else runs.push([it]);
  }
  let y = 0;
  let w = 0;
  runs.forEach((run, ri) => {
    const cols = bestCols(run);
    const rows: Geo[][] = [];
    for (let i = 0; i < run.length; i += cols) rows.push(run.slice(i, i + cols));
    rows.forEach((row, k) => {
      const rh = Math.max(...row.map((i) => i.h));
      let x = 0;
      row.forEach((it, i) => {
        pos.set(it.id, { x: x + it.w / 2, y: y + rh / 2 });
        x += it.w + (row[i + 1] ? clearance(it, row[i + 1]!) : 0);
      });
      w = Math.max(w, x);
      y += rh + (rows[k + 1] ? rowGap(row, rows[k + 1]!) : runs[ri + 1] ? 2 * GUTTER - 4 : 0); // room for the next kind's label
    });
  });
  return { items, w, h: y, pos };
}

/** Columns for a grid of n similar items: the width/height ratio closest to square (ties go to the wider grid). */
function bestCols(run: Geo[]): number {
  const n = run.length;
  if (n <= 4) return n; // a handful stays in one row
  const mw = Math.max(...run.map((g) => g.w));
  const mh = Math.max(...run.map((g) => g.h));
  const cl = clearance(run[0]!, run[0]!);
  let best = 1;
  let score = Infinity;
  for (let c = 1; c <= Math.min(n, ROW_MAX); c++) {
    const r = Math.ceil(n / c);
    const sc = Math.abs(Math.log((c * mw + (c - 1) * cl) / (r * mh + (r - 1) * cl)));
    if (sc <= score + 1e-9) (best = c, (score = sc));
  }
  return best;
}

const REAR_Y: Record<string, number> = { usb: 7.5, 'midi-port': 9, 'usb-c-power': 7.5 }; // above the bottom plate: USB lines up with the board's connector
const SLOT_STEP = 37; // centre-to-centre of rear I/O slots (= the strip pitch of the mixer preset)
const SLOT_GAP = 5; // free wall between the service row (USB, MIDI, power) and the slot row
const isSlot = (g: Geo) => g.part.id === 'io-slot';

/** Rear wall, two rows: the service row at the bottom (USB, MIDI jack, USB-C power) and the I/O slot row above it. Slots sit
 *  behind the strip they serve when the audio bindings say which one, otherwise they follow each other every SLOT_STEP.
 *  Cutout y is measured up from the bottom edge of the rear wall. `old` are rear items that are already placed.
 *  Returns the rear height the slot row needs and the right edge of everything placed. */
function placeRear(spec: DeviceSpec, items: Geo[], old: Geo[], placements: Layout['placements'], thickness: number): { needH: number; right: number } {
  const service = items.filter((g) => !isSlot(g));
  const slots = items.filter(isSlot);
  const edge = (g: Geo) => placements[g.id]!.x + g.w / 2;
  const oldEdges = old.filter((g) => !isSlot(g)).map((g) => edge(g) + 12);
  let x = oldEdges.length ? Math.max(...oldEdges) : MARGIN + 5;
  for (const g of service) {
    placements[g.id] = { x: x + g.w / 2, y: thickness + (g.round && g.w > 15 ? 11 : (REAR_Y[g.id] ?? 12)), face: 'rear' };
    x += g.w + 12;
  }
  const top = (g: Geo) => placements[g.id]!.y + g.h / 2;
  const serviceTop = Math.max(thickness, ...[...old.filter((g) => !isSlot(g)), ...service].map(top));
  let right = Math.max(0, ...[...old, ...service].map(edge));
  let needH = serviceTop + thickness + 2; // the wall must hold the service row (USB, MIDI, power)
  if (slots.length || old.some(isSlot)) {
    const oldSlot = old.find(isSlot);
    const slotH = (slots[0] ?? oldSlot)!.h;
    const cy = oldSlot ? placements[oldSlot.id]!.y : serviceTop + SLOT_GAP + slotH / 2;
    let last = Math.max(-Infinity, ...old.filter(isSlot).map((g) => placements[g.id]!.x));
    const chan = new Set((spec.ioSlots ?? []).map((s) => s.id));
    for (const g of [...slots.filter((s) => chan.has(s.id)), ...slots.filter((s) => !chan.has(s.id))]) {
      const ch = spec.audio?.channels.find((c) => c.slot === g.id);
      const bound = ch && Object.values(ch.bind).map((id) => (id ? placements[id]?.x : undefined)).find((v) => v !== undefined);
      const want = chan.has(g.id) && bound !== undefined ? bound : last + SLOT_STEP;
      const sx = Number.isFinite(last) ? Math.max(want, last + SLOT_STEP) : Math.max(want, g.w / 2 + 5);
      placements[g.id] = { x: sx, y: cy, face: 'rear' };
      last = sx;
    }
    needH = Math.max(needH, cy + slotH / 2 + thickness + 3);
    right = Math.max(right, last + (slots[0] ?? oldSlot)!.w / 2);
    for (const g of slots) right = Math.max(right, edge(g));
  }
  return { needH, right };
}

/** Strips become columns left to right (pots/encoders, buttons in pairs, meter beside the fader nearest the player);
 *  everything else forms sections to the right. Strips get a big number on the panel. Rear parts (USB, MIDI jack) go on the rear wall.
 *  Long panels slope down towards the player (wedge). */
export function autoLayout(spec: DeviceSpec): Layout {
  const first = layoutPass(spec, {});
  const need = Math.ceil(first.rearRight + MARGIN);
  if (!first.canWiden || first.contentWidth >= need - 2) return first.layout;
  // The rear wall (I/O slots) is wider than the top content: let the sections beside the strips use that width. Fewer rows per
  // column makes more columns; the gap between columns then soaks up what is left.
  let best = first;
  for (let h = Math.floor(first.stripHeight); h >= 80; h -= 8) {
    const wide = layoutPass(spec, { restMaxH: h, gap: MAX_COLUMN_GAP });
    best = wide;
    if (wide.contentWidth < need) continue;
    for (let gap = GUTTER; gap <= MAX_COLUMN_GAP; gap += 2) {
      const t = layoutPass(spec, { restMaxH: h, gap });
      if (t.contentWidth >= need - 2) return t.layout;
    }
    return wide.layout;
  }
  return best.layout;
}

function layoutPass(spec: DeviceSpec, opt: { restMaxH?: number; gap?: number }): { layout: Layout; rearRight: number; contentWidth: number; canWiden: boolean; stripHeight: number } {
  const all = new Map(geos({ ...spec, layout: undefined }).map((g) => [g.id, g]));
  const rear = [...all.values()].filter((g) => g.face === 'rear');
  for (const g of rear) all.delete(g.id);
  const claimed = new Set<string>();
  const sorted = (ids: string[]) => ids.flatMap((id) => all.get(id) ?? []).sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  const groups = (spec.groups ?? []).map((g) => ({ g, items: sorted(g.members.filter((id) => !claimed.has(id) && claimed.add(id))) }));
  const strips = groups.filter((x) => x.g.kind === 'strip' && x.items.length);
  const rest = groups.filter((x) => x.g.kind !== 'strip' && x.items.length).map((x) => x.items);
  const loose = sorted([...all.keys()].filter((id) => !claimed.has(id)));
  // phones jacks (top-panel parts that are not controls) stay with the last section, next to its knobs
  const ports = loose.filter((g) => g.kind === 'port');
  const others = loose.filter((g) => g.kind !== 'port');
  if (ports.length && rest.length) rest[rest.length - 1] = [...rest[rest.length - 1]!, ...ports].sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  else others.push(...ports);
  if (others.length) rest.push(others);

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
  const firstButton = sBlocks[0]?.items.find((g) => g.kind === 'button');
  const stripButtonY = firstButton ? sBlocks[0]!.pos.get(firstButton.id)!.y : undefined;
  const rBlocks = rest.map((items) => flow(items, opt.restMaxH ?? maxH, opt.gap, opt.restMaxH !== undefined ? maxH : undefined, stripButtonY));
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

  const blank = all.size === 0; // nothing on top yet: a panel big enough for the board and the rear ports
  const panelDepth = Math.max(Math.ceil(depth + top + MARGIN), blank ? 70 : 0);
  const panelWidth = Math.max(Math.ceil(width + 2 * MARGIN), blank ? 90 : 0);
  const items = [...all.values()];
  const maxBody = Math.max(0, ...items.map((g) => g.fp.bodyDepth));
  const boardH = MCUS[spec.mcu].board.height;
  let height = Math.ceil(2 * thickness + maxBody + boardH);
  let frontHeight: number | undefined;
  const drop = Math.min(30, Math.round(panelDepth * Math.sin((WEDGE_DEG * Math.PI) / 180)));
  const rearPlaced = placeRear(spec, rear, [], placements, thickness);
  if (rearPlaced.needH > height || drop >= 3) {
    const topH = rearPlaced.needH > height ? Math.ceil(rearPlaced.needH) : undefined;
    if (topH === undefined) {
      // every part must clear the underside of the sloping panel: room(s) = height - 2t - drop * s / depth
      const need = Math.max(2 * thickness + 15, ...items.map((g) => 2 * thickness + g.fp.bodyDepth + 3 + (drop * placements[g.id]!.y) / panelDepth));
      height = Math.ceil(need);
      frontHeight = height - drop;
    } else {
      // the rear wall must be tall enough for the I/O slots: keep the FRONT as low as the parts allow
      height = topH;
      const front = Math.max(2 * thickness + 15, ...items.filter((g) => placements[g.id]!.y > 0).map((g) => height + ((g.fp.bodyDepth + 3 - (height - 2 * thickness)) * panelDepth) / placements[g.id]!.y));
      frontHeight = Math.ceil(front);
      if (height - frontHeight < 3) frontHeight = undefined; // not worth a wedge
    }
  }
  return {
    layout: {
      panel: { width: Math.max(panelWidth, Math.ceil(rearPlaced.right + MARGIN)), depth: panelDepth, height, ...(frontHeight !== undefined && { frontHeight }), thickness, cornerRadius: 4 },
      placements,
      annotations,
    },
    rearRight: rearPlaced.right,
    contentWidth: panelWidth,
    canWiden: maxH !== undefined && rBlocks.length > 0,
    stripHeight: maxH ?? 0,
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
    // Untouched layout (exactly what autoLayout makes of the controls placed so far)? Then lay everything out again, so that
    // controls added one by one end up in a compact grid instead of one column below the other.
    const ids = new Set(placed.map((g) => g.id));
    const base: DeviceSpec = { ...structuredClone(out), layout: undefined, controls: out.controls.filter((c) => ids.has(c.id)), meters: (out.meters ?? []).filter((m) => ids.has(m.id)) };
    const auto = autoLayout(base);
    const same = placed.every((g) => {
      const a = auto.placements[g.id];
      const b = lay.placements[g.id]!;
      return a && Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && (a.face ?? 'top') === (b.face ?? 'top');
    });
    if (same) return { ...out, layout: autoLayout(out) };
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
    const r = placeRear(out, missRear, placed.filter((g) => g.face === 'rear'), lay.placements, lay.panel.thickness);
    lay.panel.width = Math.max(lay.panel.width, Math.ceil(r.right + MARGIN));
    lay.panel.height = Math.max(lay.panel.height, Math.ceil(r.needH));
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
      const g = placed.find((x) => x.id === c.id.split('#')[0])!;
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
    if (grp.kind === 'section') continue; // sections may span several columns on purpose
    const m = grp.members.flatMap((id) => placed.find((g) => g.id === id) ?? []);
    if (m.length < 2) continue;
    // connected components: members within 60 mm of each other belong together
    const comp = m.map((_, i) => i);
    const root = (i: number): number => (comp[i] === i ? i : (comp[i] = root(comp[i]!)));
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++)
        if (gap(m[i]!, at(m[i]!).x, at(m[i]!).y, m[j]!, at(m[j]!).x, at(m[j]!).y) <= 60) comp[root(i)] = root(j);
    if (new Set(m.map((_, i) => root(i))).size > 1) add('info', `Group "${grp.label}" is spread over the panel; its members are not next to each other`, grp.members[0]);
  }
  return out;
}
