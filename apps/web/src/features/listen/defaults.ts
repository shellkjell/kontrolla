import { CHANNEL_DEFAULTS, MASTER_DEFAULTS } from '@kontrolla/audio';
import type { DeviceSpec } from '@kontrolla/core';

/**
 * Where the knobs of an audio mixer start: every bound control at the engine's default (gain and fader at 0 dB,
 * EQ / filter / pan centred, FX send closed). Without this the virtual panel starts every control at half travel,
 * which on a mixer means a very quiet, very odd channel.
 */
export function audioDefaults(spec: DeviceSpec): Record<string, number> {
  const out: Record<string, number> = {};
  const a = spec.audio;
  if (!a) return out;
  const set = (id: string | undefined, cc: number) => {
    const c = spec.controls.find((x) => x.id === id);
    if (c && (c.kind === 'pot' || c.kind === 'fader')) out[c.id] = cc / 127; // the engine normalises min..max back to 0..127
  };
  for (const ch of a.channels)
    for (const [param, id] of Object.entries(ch.bind)) set(id, CHANNEL_DEFAULTS[param as keyof typeof CHANNEL_DEFAULTS] ?? 64);
  for (const [param, id] of Object.entries(a.master.bind)) set(id, MASTER_DEFAULTS[param as keyof typeof MASTER_DEFAULTS] ?? 64);
  return out;
}
