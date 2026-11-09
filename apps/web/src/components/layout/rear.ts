// Rear face + audio I/O helpers for the Design page. Pure functions; core owns the data (IO_MODULES, AUDIO_BOARDS, spec.ioSlots).
import { AUDIO_BOARDS, IO_MODULES, PARTS } from '@kontrolla/core';
import type { DeviceSpec, Group, IoModule, Placement } from '@kontrolla/core';

export type Face = 'top' | 'rear';
export const faceOf = (p?: Placement): Face => p?.face ?? 'top';

/** Rear placements keep y UP from the bottom of the wall. The canvas draws y down, so it works on a mirrored copy
 *  (y -> height - y). Mirroring twice gives the original back, so edits are mirrored again before they are committed. */
export function flipRear(spec: DeviceSpec): DeviceSpec {
  const lay = spec.layout;
  if (!lay) return spec;
  const H = lay.panel.height;
  const placements = Object.fromEntries(Object.entries(lay.placements).map(([id, p]) => [id, p.face === 'rear' ? { ...p, y: Math.round((H - p.y) * 100) / 100 } : p]));
  return { ...spec, layout: { ...lay, placements } };
}

/** Rear/top parts that are not controls: USB opening, MIDI jack, I/O slots, master output slots, phones jacks, power opening. */
export function virtualPart(spec: DeviceSpec, id: string): string | undefined {
  if (id === 'usb') return 'usb-micro-b';
  if (id === 'midi-port') return spec.midiPort?.part;
  if (id === 'usb-c-power') return 'usb-c-power';
  if (id === 'phones-63') return 'phones-jack-63';
  if (id === 'phones-35') return 'phones-jack-35';
  return isSlotId(spec, id) ? 'io-slot' : undefined;
}

export const isSlotId = (spec: DeviceSpec, id: string): boolean => id.startsWith('master:') || !!spec.ioSlots?.some((s) => s.id === id);
export const isInputSlot = (spec: DeviceSpec, id: string): boolean => !!spec.ioSlots?.some((s) => s.id === id);
/** Module sitting in a slot id ("ch3-io" or "master:<module>"). */
export const moduleIdOf = (spec: DeviceSpec, id: string): string | undefined => (id.startsWith('master:') ? id.slice(7) : spec.ioSlots?.find((s) => s.id === id)?.module);

/** The strip (or the master section) a slot belongs to. */
export function ownerOfSlot(spec: DeviceSpec, slotId: string): Group | undefined {
  if (slotId.startsWith('master:')) return spec.groups?.find((g) => g.id === 'master');
  const ch = spec.audio?.channels.find((c) => c.slot === slotId);
  return spec.groups?.find((g) => g.id === (ch?.id ?? slotId.replace(/-io$/, '')));
}
/** The slot serving a strip group. */
export const slotOfGroup = (spec: DeviceSpec, groupId: string): string | undefined =>
  spec.audio?.channels.find((c) => c.id === groupId)?.slot ?? spec.ioSlots?.find((s) => s.id === `${groupId}-io`)?.id;

export const MODULE_SHORT: Record<string, string> = {
  'io-dual-trs': '2× TRS', 'io-dual-mini': '2× MINI', 'io-rca': 'RCA', 'io-stereo-trs': 'ST TRS', 'io-stereo-mini': 'ST MINI',
  'io-xlr': 'XLR', 'io-dual-xlr': '2× XLR', 'io-trs-rca-combo': 'TRS|RCA',
  'out-trs-rca-combo': 'OUT TRS|RCA', 'out-xlr-pair': 'OUT XLR', 'out-booth': 'BOOTH',
};

/** Text on the canvas for a placed thing. */
export function labelOf(spec: DeviceSpec, id: string): string {
  const c = spec.controls.find((x) => x.id === id) ?? spec.meters?.find((x) => x.id === id);
  if (c) return c.label || id;
  const fixed: Record<string, string> = { usb: 'USB', 'midi-port': 'MIDI', 'usb-c-power': 'USB-C PWR', 'phones-63': 'Phones 6.3', 'phones-35': 'Phones 3.5' };
  if (fixed[id]) return fixed[id]!;
  const m = moduleIdOf(spec, id);
  return (m && MODULE_SHORT[m]) || spec.ioSlots?.find((s) => s.id === id)?.label || id;
}

// ---- module facts for the picker ----------------------------------------------------------------------------------

export function levelBadges(m: IoModule): string[] {
  if (m.direction === 'in') {
    return (m.inputs ?? []).map((i) => {
      const lv = i.preampDb > 0 ? 'Mic' : i.nominalDbV > 0 ? '+4 dBu' : '−10 dBV';
      return m.inputs!.length > 1 ? `${i.id}: ${lv}` : lv;
    });
  }
  return [/\+4 dBu/.test(m.levelNote) ? '+4 dBu' : '', /-10 dBV/.test(m.levelNote) ? '−10 dBV' : ''].filter(Boolean);
}

/** Parts + PCB, approx. USD. */
export const modulePrice = (m: IoModule): number =>
  Math.round(m.pcbUsd + m.frontEnd.reduce((s, l) => s + l.priceUsd * l.qty, 0) + m.connectors.reduce((s, c) => s + (PARTS[c.part]?.priceUsd ?? 0), 0));

/** Modules a slot can hold: inputs for channel slots, rear output plates for the master slots. */
export const modulesFor = (spec: DeviceSpec, slotId: string): IoModule[] =>
  Object.values(IO_MODULES).filter((m) => m.mount === 'slot' && m.direction === (isInputSlot(spec, slotId) ? 'in' : 'out'));

// ---- board capacity -----------------------------------------------------------------------------------------------

export interface BoardUse {
  board: string;
  inputsUsed: number;
  inputsMax: number;
  channels: number;
  channelsMax: number;
  over: boolean;
  /** Channels (by order) that do not fit the board's codec inputs. */
  overflow: string[];
}
export function boardUse(spec: DeviceSpec, boardId = spec.audio?.board ?? ''): BoardUse | undefined {
  const b = AUDIO_BOARDS[boardId];
  if (!b || !spec.audio) return undefined;
  let used = 0;
  const overflow: string[] = [];
  for (const ch of spec.audio.channels) {
    const ports = IO_MODULES[spec.ioSlots?.find((s) => s.id === ch.slot)?.module ?? '']?.codecPorts ?? 2;
    if (used + ports > b.inputs) overflow.push(ch.id);
    else used += ports;
  }
  const total = spec.audio.channels.reduce((s, ch) => s + (IO_MODULES[spec.ioSlots?.find((x) => x.id === ch.slot)?.module ?? '']?.codecPorts ?? 2), 0);
  return { board: boardId, inputsUsed: total, inputsMax: b.inputs, channels: spec.audio.channels.length, channelsMax: b.stereoChannels, over: total > b.inputs, overflow };
}
