import type { Control, DeviceSpec } from '@kontrolla/core';

/** What a control does to the built-in sound. Notes and drums are for buttons; the rest are for knobs, faders and encoders. */
export type Role = 'none' | 'cutoff' | 'resonance' | 'reverb' | 'attack' | 'release' | 'detune' | 'level' | 'pitch' | 'note' | 'drum';

export const ROLE_LABEL: Record<Role, string> = {
  none: 'Nothing',
  cutoff: 'Filter cutoff',
  resonance: 'Filter resonance',
  reverb: 'Reverb amount',
  attack: 'Attack (how fast a note swells)',
  release: 'Release (how long it rings)',
  detune: 'Detune',
  level: 'Volume',
  pitch: 'Transpose',
  note: 'Plays a note',
  drum: 'Plays a drum',
};
export const ANALOG_ROLES: Role[] = ['none', 'cutoff', 'resonance', 'reverb', 'attack', 'release', 'detune', 'level'];
export const ENCODER_ROLES: Role[] = ['none', 'pitch', 'detune', 'cutoff'];
export const BUTTON_ROLES: Role[] = ['none', 'note', 'drum'];

export const rolesFor = (c: Control): Role[] => (c.kind === 'button' ? BUTTON_ROLES : c.kind === 'encoder' ? ENCODER_ROLES : ANALOG_ROLES);

const POT_ORDER: Role[] = ['cutoff', 'resonance', 'reverb', 'attack', 'release', 'detune'];
const FADER_ORDER: Role[] = ['level', 'cutoff', 'resonance', 'reverb', 'attack', 'release'];

/**
 * First sensible assignment: knobs run down cutoff, resonance, reverb, attack, release, detune; the first fader is volume;
 * the first encoder transposes; buttons play notes, or drums when there are eight or more and no knobs to shape a synth.
 */
export function defaultRoles(spec: DeviceSpec): Record<string, Role> {
  const out: Record<string, Role> = {};
  const hasVolume = spec.controls.some((c) => c.kind === 'fader');
  let pots = 0;
  let faders = 0;
  let encs = 0;
  const buttons = spec.controls.filter((c) => c.kind === 'button').length;
  const drums = buttons >= 8 && !spec.controls.some((c) => c.kind === 'pot');
  for (const c of spec.controls) {
    if (c.kind === 'pot') out[c.id] = POT_ORDER[pots++] ?? 'none';
    else if (c.kind === 'fader') out[c.id] = (hasVolume ? FADER_ORDER : POT_ORDER)[faders++] ?? 'none';
    else if (c.kind === 'encoder') out[c.id] = encs++ === 0 ? 'pitch' : 'detune';
    else out[c.id] = drums ? 'drum' : 'note';
  }
  return out;
}
