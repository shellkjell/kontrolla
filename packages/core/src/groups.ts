// Groups (strips, sections): create, edit, and duplicate with auto-offset MIDI, LEDs and panel position.
import { allocateLeds } from './allocate';
import { groupBBox } from './layout';
import type { Control, DeviceSpec, Group, Meter } from './types';

const GUTTER = 8; // mm between a group and its copy
const MARGIN = 12;

const exists = (spec: DeviceSpec, id: string) => spec.controls.some((c) => c.id === id) || !!spec.meters?.some((m) => m.id === id);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';

/** Replace the LAST run of digits by n + delta ("Ch 1" -> "Ch 2", "ch1-gain" -> "ch2-gain"). null if there is none. */
const bump = (s: string, delta: number): string | null => {
  const m = [...s.matchAll(/\d+/g)].pop();
  return m ? s.slice(0, m.index) + (Number(m[0]) + delta) + s.slice(m.index! + m[0].length) : null;
};

export function groupOf(spec: DeviceSpec, memberId: string): Group | undefined {
  return spec.groups?.find((g) => g.members.includes(memberId));
}

export function createGroup(
  input: DeviceSpec,
  label: string,
  members: string[],
  opts: { id?: string; kind?: Group['kind']; color?: string } = {},
): DeviceSpec {
  const spec = structuredClone(input);
  const groups = (spec.groups ??= []);
  const ids = members.filter((id) => exists(spec, id));
  for (const g of groups) g.members = g.members.filter((id) => !ids.includes(id));
  let id = opts.id ?? slug(label);
  for (let n = 2; groups.some((g) => g.id === id) || exists(spec, id); n++) id = `${opts.id ?? slug(label)}-${n}`;
  groups.push({ id, label, ...(opts.color && { color: opts.color }), ...(opts.kind && { kind: opts.kind }), members: ids });
  spec.groups = groups.filter((g) => g.members.length > 0);
  return spec;
}

export function ungroup(input: DeviceSpec, groupId: string): DeviceSpec {
  const spec = structuredClone(input);
  spec.groups = spec.groups?.filter((g) => g.id !== groupId);
  return spec;
}

/** Adds members (taking them out of any other group). */
export function addToGroup(input: DeviceSpec, groupId: string, ids: string[]): DeviceSpec {
  const spec = structuredClone(input);
  const add = ids.filter((id) => exists(spec, id));
  for (const g of spec.groups ?? []) g.members = g.id === groupId ? [...g.members, ...add.filter((id) => !g.members.includes(id))] : g.members.filter((id) => !add.includes(id));
  return spec;
}

export function removeFromGroup(input: DeviceSpec, groupId: string, ids: string[]): DeviceSpec {
  const spec = structuredClone(input);
  const g = spec.groups?.find((x) => x.id === groupId);
  if (g) g.members = g.members.filter((id) => !ids.includes(id));
  return spec;
}

interface Target {
  type: 'cc' | 'note';
  channel: number;
  num: number;
}
const targetsOf = (spec: DeviceSpec): Target[] => [
  ...spec.controls.map((c): Target => (c.midi.type === 'cc' ? { type: 'cc', channel: c.midi.channel, num: c.midi.cc } : { type: 'note', channel: c.midi.channel, num: c.midi.note })),
  ...(spec.meters ?? []).map((m): Target => ({ type: 'cc', channel: m.midi.channel, num: m.midi.cc })),
];

/** Lowest unused CC (1-119) or note (0-127). With a channel: on that channel; without: the first channel with room. */
export function nextFreeMidi(spec: DeviceSpec, type: 'cc' | 'note', channel?: number): { channel: number; number: number } | undefined {
  const used = new Set(targetsOf(spec).filter((t) => t.type === type).map((t) => `${t.channel}:${t.num}`));
  const [lo, hi] = type === 'cc' ? [1, 119] : [0, 127];
  for (const ch of channel === undefined ? Array.from({ length: 16 }, (_, i) => i + 1) : [channel])
    for (let n = lo; n <= hi; n++) if (!used.has(`${ch}:${n}`)) return { channel: ch, number: n };
  return undefined;
}

/** Copy a group `times` times. Fresh ids, labels with the trailing number bumped ("Ch 1" -> "Ch 2"), MIDI shifted by the group's
 *  span (or onto the next channel when the number range runs out), new LED slots, pins cleared (run allocatePins again),
 *  placed to the right of the original when a layout exists. Colors are kept. */
export function duplicateGroup(input: DeviceSpec, groupId: string, times = 1): DeviceSpec {
  let spec = structuredClone(input);
  const src = spec.groups?.find((g) => g.id === groupId);
  if (!src) throw new Error(`No group "${groupId}"`);
  const srcControls = spec.controls.filter((c) => src.members.includes(c.id));
  const srcMeters = (spec.meters ?? []).filter((m) => src.members.includes(m.id));
  const box = groupBBox(spec, groupId);
  let at = src;

  for (let k = 1; k <= times; k++) {
    const groups = spec.groups!;
    // delta: smallest n so group label and id are unused
    let delta = 1;
    const free = (n: number) => !groups.some((g) => g.label === (bump(src.label, n) ?? src.label) || g.id === (bump(src.id, n) ?? `${src.id}${n + 1}`));
    while (!free(delta)) delta++;
    const idMap = new Map<string, string>();
    const newId = (id: string): string => {
      let n = delta;
      for (;;) {
        const c = bump(id, n) ?? `${id}${n + 1}`;
        if (!exists(spec, c) && !groups.some((g) => g.id === c) && ![...idMap.values()].includes(c)) return c;
        n++;
      }
    };
    for (const id of src.members) idMap.set(id, newId(id));
    const label = (l: string | undefined) => (l === undefined ? undefined : (bump(l, delta) ?? l));

    // MIDI shift per target type: same span on this channel, else next channel keeping the numbers
    const shift = (type: 'cc' | 'note') => {
      const mine = targetsOf({ ...spec, controls: srcControls, meters: srcMeters }).filter((t) => t.type === type);
      if (!mine.length) return (_c: number, n: number) => ({ channel: _c, num: n });
      const span = Math.max(...mine.map((t) => t.num)) - Math.min(...mine.map((t) => t.num)) + 1;
      const taken = new Set(targetsOf(spec).filter((t) => t.type === type).map((t) => `${t.channel}:${t.num}`));
      const fits = (dCh: number, dNum: number) => mine.every((t) => t.channel + dCh <= 16 && t.num + dNum <= 127 && !taken.has(`${t.channel + dCh}:${t.num + dNum}`));
      for (let dCh = 0; dCh < 16; dCh++)
        for (let m = dCh === 0 ? 1 : 0; m * span <= 127; m++) if (fits(dCh, m * span)) return (c: number, n: number) => ({ channel: c + dCh, num: n + m * span });
      throw new Error(`Out of MIDI ${type === 'cc' ? 'CC numbers' : 'notes'} for a copy of "${src.label}"`);
    };
    const cc = shift('cc');
    const note = shift('note');

    const newControls = srcControls.map((c): Control => {
      const n = structuredClone(c);
      n.id = idMap.get(c.id)!;
      n.label = label(c.label);
      if (n.label === undefined) delete n.label;
      if (n.kind === 'encoder') (delete n.pinA, delete n.pinB);
      else (delete n.pin, delete n.mux);
      if (n.kind === 'button' && n.led) n.led.index = -1;
      if (n.midi.type === 'cc') {
        const t = cc(n.midi.channel, n.midi.cc);
        ((n.midi.channel = t.channel), (n.midi.cc = t.num));
      } else {
        const t = note(n.midi.channel, n.midi.note);
        ((n.midi.channel = t.channel), (n.midi.note = t.num));
      }
      return n;
    });
    const newMeters = srcMeters.map((m): Meter => {
      const t = cc(m.midi.channel, m.midi.cc);
      const n = structuredClone(m);
      n.id = idMap.get(m.id)!;
      n.label = label(m.label);
      if (n.label === undefined) delete n.label;
      n.ledStart = -1;
      n.midi = { channel: t.channel, cc: t.num };
      return n;
    });
    spec.controls.push(...newControls);
    spec.meters = [...(spec.meters ?? []), ...newMeters];
    const copy: Group = { ...structuredClone(src), id: newId(src.id), label: bump(src.label, delta) ?? src.label, members: src.members.map((id) => idMap.get(id)!) };
    spec.groups!.splice(spec.groups!.indexOf(at) + 1, 0, copy);
    at = copy;

    if (spec.layout && box) {
      const dx = k * (box.w + GUTTER);
      for (const [from, to] of idMap) {
        const p = spec.layout.placements[from];
        if (p) spec.layout.placements[to] = { ...p, x: p.x + dx };
      }
      spec.layout.panel.width = Math.max(spec.layout.panel.width, Math.ceil(box.x + box.w + dx + MARGIN));
      const num = spec.layout.annotations.find((a) => a.id === `num-${src.id}`);
      if (num?.kind === 'text') spec.layout.annotations.push({ ...num, id: `num-${copy.id}`, x: num.x + dx, text: bump(num.text, delta) ?? num.text });
    }
  }
  return allocateLeds(spec);
}
