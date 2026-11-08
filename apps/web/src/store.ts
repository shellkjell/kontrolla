import type { Control, DeviceSpec, McuId } from '@kontrolla/core';

export type Step = 'start' | 'design' | 'test' | 'build';
export interface Saved {
  spec: DeviceSpec | null;
  step: Step;
}

const KEY = 'kontrolla.design.v1';

export function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (s?.spec?.version === 1 && Array.isArray(s.spec.controls) && Array.isArray(s.spec.muxes)) return s;
  } catch {
    // corrupt or unavailable storage: start fresh
  }
  return { spec: null, step: 'start' };
}

export const save = (s: Saved): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / quota: the design just won't survive a reload
  }
};

export const blank = (mcu: McuId): DeviceSpec => ({
  version: 1, name: 'My Controller', mcu, usbProductName: 'kont.rolla My Controller', muxes: [], controls: [],
});

/** Pins are board-specific, so a board change drops them all and lets allocatePins start over. */
export const withMcu = (spec: DeviceSpec, mcu: McuId): DeviceSpec => ({
  ...spec,
  mcu,
  muxes: [],
  controls: spec.controls.map((c) => {
    const { pin: _p, mux: _m, pinA: _a, pinB: _b, ...rest } = c as Control & { pin?: number; mux?: unknown; pinA?: number; pinB?: number };
    return rest as Control;
  }),
});

export type Kind = Control['kind'];
export const KIND_INFO: Record<Kind, { noun: string; prefix: string; part: string }> = {
  pot: { noun: 'Knob', prefix: 'pot', part: 'pot-b10k' },
  fader: { noun: 'Fader', prefix: 'fader', part: 'fader-60mm-b10k' },
  button: { noun: 'Pad', prefix: 'btn', part: 'button-tact-6mm' },
  encoder: { noun: 'Encoder', prefix: 'enc', part: 'encoder-ec11' },
};

/** A new control with the next free id/label and a MIDI number nobody uses yet. */
export function newControl(spec: DeviceSpec, kind: Kind): Control {
  const info = KIND_INFO[kind];
  let n = 1;
  while (spec.controls.some((c) => c.id === `${info.prefix}${n}`)) n++;
  const free = (type: 'cc' | 'note', from: number) => {
    const taken = new Set(spec.controls.filter((c) => c.midi.type === type && c.midi.channel === 1).map((c) => (c.midi.type === 'cc' ? c.midi.cc : c.midi.note)));
    let v = from;
    while (taken.has(v) && v < 127) v++;
    return v;
  };
  const base = { id: `${info.prefix}${n}`, part: info.part, label: `${info.noun} ${n}` };
  const cc = { type: 'cc' as const, channel: 1, cc: free('cc', 20), min: 0, max: 127 };
  if (kind === 'button')
    return { ...base, kind, midi: { type: 'note', channel: 1, note: free('note', 36), velocity: 100 }, mode: 'momentary', debounceMs: 5 } as Control;
  if (kind === 'encoder') return { ...base, kind, midi: cc, relative: false } as Control;
  return { ...base, kind, midi: cc, deadband: 12, smoothing: 64 };
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'controller';
