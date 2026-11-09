// Module gain staging, derived from the core catalog (IO_MODULES). Engine input samples are "jack volts": 1.0 = 1 Vrms = 0 dBV.
// Per input (A/B): trimDb = padDb + preampDb is the net analogue gain jack→ADC. CS42448 ADC full scale is taken as ≈ 1 Vrms
// (design brief; NOT re-checked against the datasheet; DAC/output full scale unverified), so dBFS at the ADC = dBV at the jack + trimDb.
import { IO_MODULES, moduleOfSlot, type DeviceSpec, type IoInput, type IoModule } from '@kontrolla/core';
import { CLIP_DB } from './curves';

export const FS_DBV = 0;

/** The catalog module of an engine channel. Throws on a missing slot, unknown module or an output module. */
export function channelModule(spec: DeviceSpec, channelId: string): IoModule {
  const ch = spec.audio?.channels.find((c) => c.id === channelId);
  if (!ch) throw new Error(`No audio channel "${channelId}"`);
  const id = moduleOfSlot(spec, ch.slot);
  if (!id) throw new Error(`Channel ${channelId}: slot "${ch.slot}" holds no module`);
  const m = IO_MODULES[id];
  if (!m) throw new Error(`Channel ${channelId}: unknown I/O module "${id}"`);
  if (m.direction !== 'in' || !m.inputs?.length) throw new Error(`Channel ${channelId}: module ${id} is not an input module`);
  return m;
}

/** Net analogue gain jack→ADC of one input. `preampDb` overrides the module default (must lie in gainRangeDb when the module has one). */
export function trimDbFor(m: IoModule, inp: IoInput, preampDb = inp.preampDb): number {
  const r = m.gainRangeDb;
  if (preampDb !== inp.preampDb && r && (preampDb < r[0] || preampDb > r[1])) throw new Error(`${m.id}: preamp ${preampDb} dB outside ${r[0]}..${r[1]} dB`);
  return inp.padDb + preampDb;
}
export const nominalDbfs = (m: IoModule, inp: IoInput, preampDb?: number) => inp.nominalDbV + trimDbFor(m, inp, preampDb) - FS_DBV;

export interface StagingRow { channel: string; module: string; input: 'A' | 'B'; trimDb: number; nominalDbfs: number; headroomDb: number }
/** One row per channel and module input. `preampDb[channelId]` overrides a mic module's preamp gain. */
export function gainStaging(spec: DeviceSpec, preampDb: Record<string, number> = {}): StagingRow[] {
  return (spec.audio?.channels ?? []).flatMap((c) => {
    const m = channelModule(spec, c.id);
    return m.inputs!.map((inp) => {
      const nominal = nominalDbfs(m, inp, preampDb[c.id]);
      return { channel: c.id, module: m.id, input: inp.id, trimDb: trimDbFor(m, inp, preampDb[c.id]), nominalDbfs: nominal, headroomDb: CLIP_DB - nominal };
    });
  });
}
/** Per channel: [trim of A, trim of B] (B = A for single-input modules). */
export const defaultTrimDb = (spec: DeviceSpec): [number, number][] => {
  const rows = gainStaging(spec);
  return (spec.audio?.channels ?? []).map((c) => {
    const r = rows.filter((x) => x.channel === c.id);
    return [r[0]!.trimDb, (r[1] ?? r[0]!).trimDb];
  });
};
