import type { DeviceSpec } from '@kontrolla/core';
import { noteName } from '../midi';
import { labelOf } from '../pins';

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export interface MapRow {
  control: string;
  group: string;
  channel: number;
  type: string;
  number: string;
  range: string;
  note: string;
}

/** One row per control and meter: what the DAW sees. */
export function midiMap(spec: DeviceSpec): MapRow[] {
  const groupOf = (id: string) => spec.groups?.find((g) => g.members.includes(id))?.label ?? '';
  const rows: MapRow[] = spec.controls.map((c) => {
    const t = c.midi;
    if (t.type === 'note')
      return { control: labelOf(c), group: groupOf(c.id), channel: t.channel, type: 'Note', number: `${t.note} (${noteName(t.note)})`, range: `velocity ${t.velocity}`, note: c.kind === 'button' ? `${c.mode}${c.led ? ', lit (DAW can set the light)' : ''}` : '' };
    return {
      control: labelOf(c), group: groupOf(c.id), channel: t.channel, type: 'CC', number: String(t.cc),
      range: c.kind === 'encoder' && c.relative ? 'relative (65 = right, 63 = left)' : `${t.min}-${t.max}`,
      note: c.kind === 'button' ? c.mode : '',
    };
  });
  for (const m of spec.meters ?? [])
    rows.push({ control: `${labelOf(m)} meter`, group: groupOf(m.id), channel: m.midi.channel, type: 'CC', number: String(m.midi.cc), range: '0-127', note: `input: the DAW sends the level to the device (${m.ledCount} LEDs)` });
  return rows;
}

const q = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

export function midiMapCsv(spec: DeviceSpec): string {
  const head = ['control', 'group', 'channel', 'type', 'number', 'range', 'note'];
  return [head, ...midiMap(spec).map((r) => head.map((h) => r[h as keyof MapRow]))].map((r) => r.map(q).join(',')).join('\n') + '\n';
}
