// Module gain staging. Engine input samples are "jack volts": 1.0 = 1 Vrms = 0 dBV. `trimDb` = the module's net analogue
// gain between jack and ADC (pad < 0, mic preamp > 0). CS42448 ADC full scale is taken as ≈ 1 Vrms (design brief; NOT re-checked
// against the datasheet — output FS is unverified), so dBFS at the ADC = dBV at the jack + trimDb.
import type { DeviceSpec } from '@kontrolla/core';
import { CLIP_DB } from './curves';

export const FS_DBV = 0;
export const dbuToDbv = (dbu: number) => dbu - 2.218; // 0 dBu = 0.7746 Vrms

export interface ModuleLevel {
  label: string;
  nominalDbV: number; // nominal signal at the jack
  padDb: number; // fixed analogue pad (≤ 0) or 0
  preampDb: number; // default preamp gain (mic modules), else 0
}

export const MODULE_LEVELS: Record<string, ModuleLevel> = {
  'io-rca': { label: 'RCA consumer −10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 },
  'io-dual-trs': { label: 'TRS pro +4 dBu', nominalDbV: dbuToDbv(4), padDb: -12, preampDb: 0 },
  'io-xlr': { label: 'XLR mic −50 dBu', nominalDbV: dbuToDbv(-50), padDb: 0, preampDb: 40 },
  'io-trs-rca-combo': { label: 'TRS/RCA combo (A=pro, B=consumer)', nominalDbV: dbuToDbv(4), padDb: -12, preampDb: 0 },
};
export const FALLBACK_LEVEL = MODULE_LEVELS['io-rca']!;

export const trimDbFor = (m: ModuleLevel, preampDb = m.preampDb) => m.padDb + preampDb;
export const nominalDbfs = (m: ModuleLevel, preampDb = m.preampDb) => m.nominalDbV + trimDbFor(m, preampDb) - FS_DBV;

export interface StagingRow { channel: string; module: string; trimDb: number; nominalDbfs: number; headroomDb: number }
/** Per channel: module trim for `EngineOptions.trimDb`, nominal level at the ADC and headroom to the clip threshold. */
export function gainStaging(spec: DeviceSpec, preampDb: Record<string, number> = {}): StagingRow[] {
  return (spec.audio?.channels ?? []).map((c) => {
    const mod = spec.ioSlots?.find((s) => s.id === c.slot)?.module ?? '';
    const m = MODULE_LEVELS[mod] ?? FALLBACK_LEVEL;
    const pre = preampDb[c.id];
    const nominal = nominalDbfs(m, pre);
    return { channel: c.id, module: mod, trimDb: trimDbFor(m, pre), nominalDbfs: nominal, headroomDb: CLIP_DB - nominal };
  });
}
export const defaultTrimDb = (spec: DeviceSpec) => gainStaging(spec).map((r) => r.trimDb);
