import type { DeviceSpec } from '@kontrolla/core';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI note 60 = C4. */
export const noteName = (n: number): string => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export interface Decoded {
  kind: 'cc' | 'on' | 'off' | 'other';
  text: string;
  hex: string;
  /** Matching control label, if this message is one the design sends. */
  who?: string;
}

/** "CC 21 ch1 = 64", "Note On C4 ch1 vel 100" and which control sent it. */
export function decode(msg: number[], spec: DeviceSpec): Decoded {
  const [s = 0, a = 0, b = 0] = msg;
  const hex = msg.map((x) => x.toString(16).padStart(2, '0')).join(' ').toUpperCase();
  const ch = (s & 15) + 1;
  const type = s >> 4;
  const find = (kind: 'cc' | 'note', n: number) =>
    spec.controls.find((c) => c.midi.channel === ch && (c.midi.type === 'cc' ? kind === 'cc' && c.midi.cc === n : kind === 'note' && c.midi.note === n));
  const who = (kind: 'cc' | 'note', n: number) => {
    const c = find(kind, n);
    if (c) return c.label ?? c.id;
    // incoming level CCs (DAW -> device) belong to a meter
    const m = kind === 'cc' ? spec.meters?.find((x) => x.midi.channel === ch && x.midi.cc === n) : undefined;
    return m ? `${m.label ?? m.id} meter` : undefined;
  };
  if (type === 0xb) return { kind: 'cc', text: `CC ${a} ch${ch} = ${b}`, hex, who: who('cc', a) };
  if (type === 0x9 && b > 0) return { kind: 'on', text: `Note On ${noteName(a)} ch${ch} vel ${b}`, hex, who: who('note', a) };
  if (type === 0x8 || type === 0x9) return { kind: 'off', text: `Note Off ${noteName(a)} ch${ch}`, hex, who: who('note', a) };
  return { kind: 'other', text: `Raw ${hex}`, hex };
}

export const simTime = (ms: number): string => `${(ms / 1000).toFixed(3)}s`;
