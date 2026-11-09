import { useCallback, useEffect, useRef, useState } from 'react';
import type { Control, DeviceSpec, McuId } from '@kontrolla/core';

export type Step = 'start' | 'design' | 'test' | 'build';
export interface Saved {
  spec: DeviceSpec | null;
  step: Step;
  /** Identifies the design for things saved next to it (build checklist). New on every fresh design. */
  id: string;
}

const KEY = 'kontrolla.design.v1';
export const newId = (): string => Math.random().toString(36).slice(2, 10);

export function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (s?.spec?.version === 1 && Array.isArray(s.spec.controls) && Array.isArray(s.spec.muxes)) return { spec: s.spec, step: s.step ?? 'design', id: s.id ?? newId() };
  } catch {
    // corrupt or unavailable storage: start fresh
  }
  return { spec: null, step: 'start', id: newId() };
}

/** false when the browser would not keep it (private mode, quota): the design only lives until the tab closes. */
export const save = (s: Saved): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
};

// ---- recent designs: every design that gets replaced is kept (newest first), so nothing is lost to a template click ----
export interface Recent {
  id: string;
  name: string;
  savedAt: number;
  spec: DeviceSpec;
}
const RECENT_KEY = 'kontrolla.recent.v1';
const RECENT_MAX = 8;

export function loadRecent(): Recent[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
    return Array.isArray(r) ? r.filter((x) => x?.spec?.version === 1 && Array.isArray(x.spec.controls)) : [];
  } catch {
    return [];
  }
}
const saveRecent = (r: Recent[]): void => {
  // a full storage drops the oldest entries first rather than failing outright
  for (let keep = r.length; keep >= 0; keep--) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, keep)));
      return;
    } catch {
      // try again with fewer
    }
  }
};
/** Put a design at the top of the recent list. Designs with nothing in them are not worth keeping. */
export function remember(spec: DeviceSpec, id: string): Recent[] {
  if (!spec.controls.length && !spec.meters?.length) return loadRecent();
  const next = [{ id, name: spec.name, savedAt: Date.now(), spec }, ...loadRecent().filter((x) => x.id !== id)].slice(0, RECENT_MAX);
  saveRecent(next);
  return next;
}
export function forget(id: string): Recent[] {
  const next = loadRecent().filter((x) => x.id !== id);
  saveRecent(next);
  return next;
}

interface Snapshot {
  spec: DeviceSpec;
  id: string;
}
interface Hist {
  saved: Saved;
  past: Snapshot[];
  future: Snapshot[];
  at: number; // time of the last spec change
}
const LIMIT = 100;
/** Edits closer together than this (a drag, typing) share one undo step. */
const MERGE_MS = 600;
const snap = (s: Saved): Snapshot[] => (s.spec ? [{ spec: s.spec, id: s.id }] : []);

/**
 * The design plus its undo history. `setSpec` is the single funnel for every change from any screen;
 * `replace` swaps in a different design (preset, import, shared link) and is undoable too.
 */
export function useDesign() {
  const [h, setH] = useState<Hist>(() => ({ saved: load(), past: [], future: [], at: 0 }));
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const now = useRef(h.saved);
  now.current = h.saved;
  useEffect(() => {
    const ok = save(h.saved);
    setSaveFailed(!ok);
    if (ok) setSavedAt(Date.now());
  }, [h.saved]);

  const update = useCallback(
    (fn: (spec: DeviceSpec) => DeviceSpec) =>
      setH((p) => {
        const cur = p.saved.spec;
        if (!cur) return p;
        const next = fn(cur);
        if (next === cur) return p;
        const now = Date.now();
        const merge = p.past.length > 0 && now - p.at < MERGE_MS;
        return { saved: { ...p.saved, spec: next }, past: merge ? p.past : [...p.past, ...snap(p.saved)].slice(-LIMIT), future: [], at: now };
      }),
    [],
  );
  const setSpec = useCallback((s: DeviceSpec) => update(() => s), [update]);
  const patchControls = useCallback((fn: (c: Control) => Control) => update((s) => ({ ...s, controls: s.controls.map(fn) })), [update]);
  const go = useCallback((step: Step) => setH((p) => ({ ...p, saved: { ...p.saved, step } })), []);
  const replace = useCallback(
    (spec: DeviceSpec, step: Step = 'design', id = newId()) => {
      // the design being replaced is kept under "recent designs" before anything else happens
      if (now.current.spec) setRecent(remember(now.current.spec, now.current.id));
      setH((p) => ({ saved: { spec, step, id }, past: [...p.past, ...snap(p.saved)].slice(-LIMIT), future: [], at: 0 }));
    },
    [],
  );
  const dropRecent = useCallback((id: string) => setRecent(forget(id)), []);
  const undo = useCallback(
    () =>
      setH((p) => {
        const prev = p.past.at(-1);
        return prev ? { saved: { ...p.saved, ...prev }, past: p.past.slice(0, -1), future: [...snap(p.saved), ...p.future], at: 0 } : p;
      }),
    [],
  );
  const redo = useCallback(
    () =>
      setH((p) => {
        const [next, ...rest] = p.future;
        return next ? { saved: { ...p.saved, ...next }, past: [...p.past, ...snap(p.saved)], future: rest, at: 0 } : p;
      }),
    [],
  );
  return { saved: h.saved, setSpec, patchControls, go, replace, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0, recent, dropRecent, savedAt, saveFailed };
}

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
