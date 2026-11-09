import { EXAMPLES, PARTS, autoLayout, createGroup } from '@kontrolla/core';
import type { DeviceSpec, McuId } from '@kontrolla/core';
import { removeItems } from '../components/layout/ops';
import { blank, newControl } from '../store';
import type { Kind } from '../store';

/**
 * "8 knobs for my synth" -> a design. A deterministic reader (no network, no model): it finds counts next to the words
 * for knobs, faders, pads, buttons and encoders, "N-channel mixer", and "4x4 pads", and builds the design from what core already has.
 * It always says what it understood, so a miss costs one edit.
 */
export interface Plan {
  pots: number;
  faders: number;
  pads: number;
  buttons: number;
  encoders: number;
  /** Mixer channels, 0 = not a mixer. */
  mixer: number;
  /** Pad grid as [rows, columns]; pads then counts rows x columns. */
  grid?: [number, number];
  /** Name the knobs like a synth: cutoff, resonance, ... */
  synth: boolean;
}
export const emptyPlan = (): Plan => ({ pots: 0, faders: 0, pads: 0, buttons: 0, encoders: 0, mixer: 0, synth: false });

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, twenty: 20, couple: 2, dozen: 12, a: 1, an: 1,
};
const NOUNS: Record<'pots' | 'faders' | 'pads' | 'buttons' | 'encoders', string> = {
  pots: 'knobs?|pots?|dials?|potentiometers?|rotaries|rotary',
  faders: 'faders?|sliders?',
  pads: 'pads?',
  buttons: 'buttons?|keys?|switch(?:es)?|footswitch(?:es)?|pedals?',
  encoders: 'encoders?|endless\\s+knobs?|clickers?',
};
const MAX = { pots: 32, faders: 16, pads: 32, buttons: 32, encoders: 8, mixer: 6 };

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/\ba\s+dozen\b/g, '12')
    .replace(/\b(a\s+)?couple(?:\s+of)?\b/g, '2')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)\b/g, (w) => String(WORDS[w]))
    .replace(/[,;&]|\band\b|\bplus\b/g, ' , ');

/** The number written just before a noun, allowing a couple of describing words between ("8 big rotary knobs"). */
function countOf(t: string, nouns: string): number {
  let total = 0;
  const re = new RegExp(`(?:^|[^\\w])(\\d+|an?)\\s+(?:[a-z-]+\\s+){0,2}?(?:${nouns})\\b`, 'g');
  for (const m of t.matchAll(re)) total += m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
  return total;
}

/** Null when nothing recognisable was said. */
export function parsePlan(text: string): Plan | null {
  const t = normalise(text);
  const plan = emptyPlan();
  plan.pots = countOf(t, NOUNS.pots);
  plan.faders = countOf(t, NOUNS.faders);
  plan.pads = countOf(t, NOUNS.pads);
  plan.buttons = countOf(t, NOUNS.buttons);
  plan.encoders = countOf(t, NOUNS.encoders);
  // "pedal with 3 buttons" counts the buttons once
  const grid = /(\d+)\s*(?:x|×|by)\s*(\d+)/.exec(t);
  if (grid) {
    const r = Math.min(8, Number(grid[1])), c = Math.min(8, Number(grid[2]));
    plan.grid = [r, c];
    plan.pads = r * c;
  }
  if (/\bmixer\b|\bmixing (?:desk|board|console)\b|\bdj\b.*\bchannels?\b/.test(t)) {
    const ch = /(\d+)[\s-]*(?:channels?|ch\b|strips?)/.exec(t);
    plan.mixer = Math.max(1, Math.min(MAX.mixer, ch ? Number(ch[1]) : 4));
    plan.pots = plan.faders = plan.pads = plan.buttons = plan.encoders = 0; // the mixer has its own strips
    delete plan.grid;
  }
  plan.synth = /synth|filter|cutoff|oscillator|keys?\b/.test(t);
  (Object.keys(MAX) as (keyof typeof MAX)[]).forEach((k) => (plan[k] = Math.min(MAX[k], plan[k])));
  const any = plan.mixer + plan.pots + plan.faders + plan.pads + plan.buttons + plan.encoders;
  return any > 0 ? plan : null;
}

/** "8 knobs · 2 faders", the way the page repeats it back. */
export function chips(plan: Plan): { key: keyof Omit<Plan, 'grid' | 'synth'>; n: number; label: string }[] {
  const out: { key: keyof Omit<Plan, 'grid' | 'synth'>; n: number; label: string }[] = [];
  const add = (key: keyof Omit<Plan, 'grid' | 'synth'>, n: number, one: string, many: string) => n > 0 && out.push({ key, n, label: `${n} ${n === 1 ? one : many}` });
  if (plan.mixer) add('mixer', plan.mixer, 'channel mixer', 'channel mixer');
  add('pots', plan.pots, 'knob', 'knobs');
  add('faders', plan.faders, 'fader', 'faders');
  add('pads', plan.pads, plan.grid ? 'pad' : 'pad', 'pads');
  add('buttons', plan.buttons, 'button', 'buttons');
  add('encoders', plan.encoders, 'encoder', 'encoders');
  return out;
}

const SYNTH_KNOBS = ['Cutoff', 'Resonance', 'Reverb', 'Attack', 'Release', 'Detune'];

/** Remove strips beyond `n` from a mixer preset and lay the rest out again. */
function trimMixer(base: DeviceSpec, n: number): DeviceSpec {
  const strips = (base.groups ?? []).filter((g) => g.kind === 'strip');
  let spec = base;
  const drop = strips.slice(n).flatMap((g) => g.members);
  if (drop.length) spec = removeItems(spec, drop);
  return { ...spec, name: `${n}-channel mixer`, layout: autoLayout(spec) };
}

export function planToSpec(plan: Plan, mcu: McuId): DeviceSpec {
  if (plan.mixer) return trimMixer(structuredClone(EXAMPLES[plan.mixer <= 3 ? 'mixer-3ch' : 'mixer-6ch']!), plan.mixer);

  const name = plan.synth && plan.pots ? 'Synth controller' : 'Custom controller';
  let spec = blank(mcu);
  spec = { ...spec, name, usbProductName: `kont.rolla ${name}`.slice(0, 31) };
  const ids: Record<'pots' | 'faders' | 'pads' | 'buttons' | 'encoders', string[]> = { pots: [], faders: [], pads: [], buttons: [], encoders: [] };
  const add = (kind: Kind, group: keyof typeof ids, label: (i: number) => string, part?: string) => {
    const c = { ...newControl(spec, kind), ...(part && { part }) };
    c.label = label(ids[group].length);
    spec = { ...spec, controls: [...spec.controls, c] };
    ids[group].push(c.id);
  };
  for (let i = 0; i < plan.pots; i++) add('pot', 'pots', (k) => (plan.synth ? SYNTH_KNOBS[k] : undefined) ?? `Knob ${k + 1}`);
  for (let i = 0; i < plan.faders; i++) add('fader', 'faders', (k) => `Fader ${k + 1}`);
  for (let i = 0; i < plan.encoders; i++) add('encoder', 'encoders', (k) => `Encoder ${k + 1}`);
  for (let i = 0; i < plan.pads; i++) add('button', 'pads', (k) => `Pad ${k + 1}`, 'button-cherry-mx');
  for (let i = 0; i < plan.buttons; i++) add('button', 'buttons', (k) => `Button ${k + 1}`);

  const section = (label: string, list: string[]) => list.length > 1 && (spec = createGroup(spec, label, list, { kind: 'section' }));
  section('Knobs', ids.pots);
  section('Faders', ids.faders);
  section('Encoders', ids.encoders);
  section('Pads', ids.pads);
  section('Buttons', ids.buttons);
  spec = { ...spec, layout: autoLayout(spec) };

  // "4x4 pads": rows of exactly that many, on the part's own pitch
  if (plan.grid && ids.pads.length === plan.grid[0] * plan.grid[1]) {
    const [rows, cols] = plan.grid;
    const pitch = PARTS['button-cherry-mx']?.footprint?.minPitch ?? 19.05;
    const lay = structuredClone(spec.layout!);
    const first = lay.placements[ids.pads[0]!]!;
    ids.pads.forEach((id, i) => {
      lay.placements[id] = { ...lay.placements[id], x: first.x + (i % cols) * pitch, y: first.y + Math.floor(i / cols) * pitch };
    });
    lay.panel.width = Math.max(lay.panel.width, Math.ceil(first.x + (cols - 1) * pitch + 12 + 10));
    lay.panel.depth = Math.max(lay.panel.depth, Math.ceil(first.y + (rows - 1) * pitch + 12 + 10));
    spec = { ...spec, layout: lay };
  }
  return spec;
}

export const EXAMPLE_PROMPTS = [
  '8 knobs for my synth',
  '6-channel DJ mixer with EQ',
  '16 pads and 4 faders',
  '4×4 pad grid',
  'kick-snare pedal with 3 buttons',
];

/** Template ids from closest to furthest, by how far their control counts are from the plan. */
export function closestTemplates(plan: Plan, templates: { id: string; spec: DeviceSpec }[]): string[] {
  const count = (s: DeviceSpec, k: string) => s.controls.filter((c) => c.kind === k).length;
  const dist = (t: { id: string; spec: DeviceSpec }) => {
    if (plan.mixer) return t.spec.audio ? Math.abs(t.spec.audio.channels.length - plan.mixer) : 99;
    if (t.spec.audio) return 99;
    return (
      Math.abs(count(t.spec, 'pot') - plan.pots) + Math.abs(count(t.spec, 'fader') - plan.faders) +
      Math.abs(count(t.spec, 'button') - plan.pads - plan.buttons) + Math.abs(count(t.spec, 'encoder') - plan.encoders)
    );
  };
  return templates.filter((t) => t.id !== 'blank').sort((a, b) => dist(a) - dist(b)).map((t) => t.id);
}
