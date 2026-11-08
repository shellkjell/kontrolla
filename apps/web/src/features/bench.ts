import type { DeviceSpec, MidiTarget } from '@kontrolla/core';
import type { AppSim } from '../sim/createSim';

/** What the Test page hands to the virtual DAW and the auto-test: the live simulator plus what has been seen on the wire. */
export interface Bench {
  sim: AppSim;
  spec: DeviceSpec;
  /** Messages the device sends to the host. */
  onDevice(cb: (msg: number[]) => void): () => void;
  /** Last LED frame the device pushed (already scaled by the global brightness). */
  frame(): Uint8Array | null;
  /** Where the control sits on the virtual panel, 0..1. */
  value(id: string): number;
  /** Moves the control on the panel and in the simulator. */
  setAnalog(id: string, x: number): void;
  /** Last value per target (`cc:1:20`, `note:1:24`) the device sent. Notes: velocity, 0 = off. */
  seen: Map<string, number>;
}

export interface Parsed {
  type: 'cc' | 'note';
  ch: number; // 1-16
  num: number;
  value: number;
  /** Note on (velocity > 0) or CC value >= 64. */
  on: boolean;
}

export function parse(msg: number[]): Parsed | null {
  const [s = 0, a = 0, b = 0] = msg;
  const ch = (s & 15) + 1;
  const t = s >> 4;
  if (t === 0xb) return { type: 'cc', ch, num: a, value: b, on: b >= 64 };
  if (t === 0x9) return { type: 'note', ch, num: a, value: b, on: b > 0 };
  if (t === 0x8) return { type: 'note', ch, num: a, value: 0, on: false };
  return null;
}

export const keyOf = (type: 'cc' | 'note', ch: number, num: number): string => `${type}:${ch}:${num}`;
export const targetKey = (t: MidiTarget): string => (t.type === 'cc' ? keyOf('cc', t.channel, t.cc) : keyOf('note', t.channel, t.note));
export const parsedKey = (p: Parsed): string => keyOf(p.type, p.ch, p.num);
export const targetMsg = (t: MidiTarget, on: boolean): number[] =>
  t.type === 'note' ? [(on ? 0x90 : 0x80) | (t.channel - 1), t.note, on ? 127 : 0] : [0xb0 | (t.channel - 1), t.cc, on ? 127 : 0];
