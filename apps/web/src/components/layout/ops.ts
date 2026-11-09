// Spec edits the Design page needs that core does not already provide. Pure: every function returns a new spec.
import { autoLayout, bindStripAudio, boxOf, duplicateGroup, ensureLayout, groupBBox, nextFreeMidi } from '@kontrolla/core';
import { boardUse, slotOfGroup } from './rear';
import type { Annotation, DeviceSpec, Group, Layout, Meter, Placement } from '@kontrolla/core';

export const GROUP_COLORS = ['#e05555', '#e08a3c', '#d4b83a', '#4caf6a', '#3c8fe0', '#9b6be0', '#d96fa8', '#5cc7c0'];
export const nextGroupColor = (spec: DeviceSpec): string => GROUP_COLORS[(spec.groups?.length ?? 0) % GROUP_COLORS.length]!;

/** The label people see for a control or meter id. */
export const nameOf = (spec: DeviceSpec, id: string): string => {
  const x = spec.controls.find((c) => c.id === id) ?? spec.meters?.find((m) => m.id === id);
  return x?.label || id;
};
export const isMeter = (spec: DeviceSpec, id: string): boolean => !!spec.meters?.some((m) => m.id === id);

/** Drop controls/meters with everything that points at them: group seats, placements. Empty groups go too. */
export function removeItems(input: DeviceSpec, ids: string[]): DeviceSpec {
  const gone = new Set(ids);
  const spec = structuredClone(input);
  spec.controls = spec.controls.filter((c) => !gone.has(c.id));
  if (spec.meters) spec.meters = spec.meters.filter((m) => !gone.has(m.id));
  if (spec.groups) spec.groups = spec.groups.map((g) => ({ ...g, members: g.members.filter((id) => !gone.has(id)) })).filter((g) => g.members.length);
  if (spec.layout) for (const id of ids) delete spec.layout.placements[id];
  return pruneAudio(spec);
}

/** Audio channels live and die with their strip: drop channels (and their I/O slots) whose strip is gone, and bindings to removed controls. */
export function pruneAudio(spec: DeviceSpec): DeviceSpec {
  const a = spec.audio;
  if (!a) return spec;
  const groups = new Set((spec.groups ?? []).map((g) => g.id));
  const here = new Set([...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)]);
  const gone = a.channels.filter((c) => !groups.has(c.id));
  a.channels = a.channels.filter((c) => groups.has(c.id));
  const keep = (b: Record<string, string | undefined>) => Object.fromEntries(Object.entries(b).filter(([, id]) => id && here.has(id)));
  for (const c of a.channels) {
    c.bind = keep(c.bind) as typeof c.bind;
    if (c.meter && !here.has(c.meter)) delete c.meter;
  }
  a.master.bind = keep(a.master.bind) as typeof a.master.bind;
  if (gone.length && spec.ioSlots) {
    const slots = new Set(gone.map((c) => c.slot));
    spec.ioSlots = spec.ioSlots.filter((s) => !slots.has(s.id));
    if (spec.layout) for (const id of slots) delete spec.layout.placements[id];
  }
  return spec;
}

/** Edit the layout in place on a copy. No-op without a layout. */
export function editLayout(input: DeviceSpec, fn: (l: Layout) => void): DeviceSpec {
  const spec = structuredClone(input);
  if (spec.layout) fn(spec.layout);
  return spec;
}

export const withPlacements = (spec: DeviceSpec, to: Record<string, Placement | { x: number; y: number }>): DeviceSpec =>
  editLayout(spec, (l) => {
    for (const [id, p] of Object.entries(to)) l.placements[id] = { ...l.placements[id], ...p };
  });

export function newMeter(spec: DeviceSpec): Meter {
  let n = 1;
  while (spec.meters?.some((m) => m.id === `meter${n}`) || spec.controls.some((c) => c.id === `meter${n}`)) n++;
  const free = nextFreeMidi(spec, 'cc');
  return { id: `meter${n}`, part: 'meter-led-bar', label: `Meter ${n}`, ledStart: -1, ledCount: 8, midi: { channel: free?.channel ?? 1, cc: free?.number ?? 20 } };
}

export const newAnnotationId = (): string => `a${Math.random().toString(36).slice(2, 8)}`;

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === 'stroke') return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

// ---- strips: "apply this pattern to all strips" -----------------------------------------------------------------

type Msg = { channel: number; cc?: number; note?: number };
const midiOf = (spec: DeviceSpec, id: string): { msg: Msg; kind: string } | undefined => {
  const c = spec.controls.find((x) => x.id === id);
  if (c) return { msg: c.midi, kind: c.kind };
  const m = spec.meters?.find((x) => x.id === id);
  return m && { msg: m.midi, kind: 'meter' };
};
const numOf = (m: Msg): number => (m.note ?? m.cc)!;
const typeOf = (m: Msg): 'cc' | 'note' => (m.note !== undefined ? 'note' : 'cc');

export interface StripInfo {
  strips: Group[];
  me: number; // index of the strip the id lives in
  slot: number; // position inside it: the same slot in another strip is its counterpart
  stride: number; // numbers a neighbouring strip uses for this message type (what duplicateGroup steps by)
}

/** Null unless id sits in a strip and at least one other strip exists. */
export function stripInfo(spec: DeviceSpec, id: string): StripInfo | undefined {
  const strips = (spec.groups ?? []).filter((g) => g.kind === 'strip');
  const me = strips.findIndex((g) => g.members.includes(id));
  const msg = midiOf(spec, id)?.msg;
  if (me < 0 || strips.length < 2 || !msg) return undefined;
  // Measured on a strip that is not being edited, so changing this control never skews the step.
  const nums = strips[me === 0 ? 1 : 0]!.members.flatMap((m) => {
    const x = midiOf(spec, m)?.msg;
    return x && typeOf(x) === typeOf(msg) ? [numOf(x)] : [];
  });
  return { strips, me, slot: strips[me]!.members.indexOf(id), stride: Math.max(1, Math.max(...nums) - Math.min(...nums) + 1) };
}

/** Give every other strip's counterpart of `id` the same message settings, stepping the number by one stride per strip. */
export function applyStripPattern(input: DeviceSpec, id: string): DeviceSpec {
  const info = stripInfo(input, id);
  if (!info) return input;
  const spec = structuredClone(input);
  const src = midiOf(spec, id)!;
  info.strips.forEach((s, j) => {
    const tid = s.members[info.slot];
    const dst = tid && j !== info.me ? midiOf(spec, tid) : undefined;
    if (!tid || !dst || dst.kind !== src.kind) return;
    let n = numOf(src.msg) + (j - info.me) * info.stride;
    let ch = src.msg.channel + Math.floor(n / 128); // ran past 127: carry on the next channel
    n = ((n % 128) + 128) % 128;
    ch = Math.min(16, Math.max(1, ch));
    const copy = structuredClone(src.msg) as Msg;
    copy.channel = ch;
    if (copy.note !== undefined) copy.note = n;
    else copy.cc = n;
    const c = spec.controls.find((x) => x.id === tid);
    if (c) c.midi = copy as typeof c.midi;
    else spec.meters!.find((m) => m.id === tid)!.midi = { channel: ch, cc: n };
  });
  return spec;
}

// ---- duplicating a strip so the copies line up with the existing strips ----------------------------------------

const GUTTER = 8; // between strips, as autoLayout leaves them

/** duplicateGroup, then seat the copies to the right of the LAST strip (core puts them one strip-width right of the original,
 *  which lands on the next strip), pushing anything further right (a master section) along and widening the panel. */
export function duplicateStrip(spec: DeviceSpec, groupId: string, times: number): DeviceSpec {
  const next = duplicateGroup(spec, groupId, times);
  const src = spec.groups?.find((g) => g.id === groupId);
  const was = spec.layout;
  const lay = next.layout;
  const bb = src && groupBBox(spec, groupId);
  if (!src || src.kind !== 'strip' || !was || !lay || !bb) return next;
  const right = Math.max(...spec.groups!.filter((g) => g.kind === 'strip').flatMap((g) => groupBBox(spec, g.id) ?? []).map((b) => b.x + b.w));
  const step = bb.w + GUTTER;
  const old = new Set(spec.groups!.map((g) => g.id));
  const copies = next.groups!.filter((g) => !old.has(g.id));
  const mine = new Set(copies.flatMap((g) => g.members));
  // everything right of the strips moves along: master section on top, master slots on the rear wall
  for (const [id, p] of Object.entries(lay.placements)) if (!mine.has(id) && (boxOf(spec, id)?.x ?? -1) >= right - 0.01) p.x += step * times;
  const dx = (c: number) => right + GUTTER - bb.x + c * step;
  copies.forEach((g, c) =>
    g.members.forEach((id, i) => {
      const from = was.placements[src.members[i]!];
      if (from) lay.placements[id] = { ...from, x: from.x + dx(c) };
    }),
  );
  lay.panel.width = was.panel.width + step * times;
  if (!spec.audio) return next;

  // audio: every copy gets its own I/O slot (same module as the original) and engine channel
  const srcSlot = slotOfGroup(spec, groupId);
  const srcModule = spec.ioSlots?.find((s) => s.id === srcSlot)?.module ?? 'io-dual-trs';
  const modules = next.groups!.filter((g) => g.kind === 'strip').map((g) => spec.ioSlots?.find((s) => s.id === slotOfGroup(spec, g.id))?.module ?? srcModule);
  const bound = bindStripAudio(next, { board: spec.audio.board, modules, masterOutputs: spec.audio.master.outputs });
  bound.audio!.master = { ...bound.audio!.master, bind: spec.audio.master.bind, ...(spec.audio.master.meters && { meters: spec.audio.master.meters }) };
  const sp = srcSlot ? was.placements[srcSlot] : undefined;
  if (sp) copies.forEach((g, c) => (bound.layout!.placements[`${g.id}-io`] = { ...sp, x: sp.x + dx(c) }));
  return ensureLayout(bound);
}

// ---- audio: swap I/O modules, pick the engine board --------------------------------------------------------------

/** Put another module in a channel slot. */
export function swapModule(spec: DeviceSpec, slotId: string, moduleId: string): DeviceSpec {
  const next = structuredClone(spec);
  const s = next.ioSlots?.find((x) => x.id === slotId);
  if (s) s.module = moduleId;
  return next;
}

/** Replace a fixed master output module; its rear slot keeps its place (the placement is keyed by module id). */
export function swapMasterModule(spec: DeviceSpec, oldId: string, newId: string): DeviceSpec {
  const next = structuredClone(spec);
  const a = next.audio;
  if (!a || a.master.outputs.includes(newId)) return spec;
  a.master.outputs = a.master.outputs.map((m) => (m === oldId ? newId : m));
  const p = next.layout?.placements[`master:${oldId}`];
  if (p && next.layout) {
    delete next.layout.placements[`master:${oldId}`];
    next.layout.placements[`master:${newId}`] = p;
  }
  return next;
}

/** Master output plates are optional: take one out of its slot (the slot goes with it)... */
export function removeMasterModule(spec: DeviceSpec, moduleId: string): DeviceSpec {
  const next = structuredClone(spec);
  if (next.audio) next.audio.master.outputs = next.audio.master.outputs.filter((m) => m !== moduleId);
  if (next.layout) delete next.layout.placements[`master:${moduleId}`];
  return next;
}
/** ...or fit another one; it takes the next free rear slot. */
export function addMasterModule(spec: DeviceSpec, moduleId: string): DeviceSpec {
  if (!spec.audio || spec.audio.master.outputs.includes(moduleId)) return spec;
  const next = structuredClone(spec);
  next.audio!.master.outputs.push(moduleId);
  return ensureLayout(next);
}

export const setBoard = (spec: DeviceSpec, board: string): DeviceSpec => ({ ...structuredClone(spec), audio: { ...structuredClone(spec.audio!), board } });

/** Move to another board; channels that do not fit its codec inputs are removed together with their strips, and the panel is arranged again. */
export function fitBoard(spec: DeviceSpec, board: string): DeviceSpec {
  const use = boardUse(setBoard(spec, board), board);
  let next = setBoard(spec, board);
  if (!use?.overflow.length) return next;
  const members = use.overflow.flatMap((id) => spec.groups?.find((g) => g.id === id)?.members ?? []);
  next = removeItems(next, members);
  return { ...next, layout: autoLayout(next) };
}
