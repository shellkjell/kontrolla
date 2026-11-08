import { MCUS } from '@kontrolla/core';
import type { Control, DeviceSpec, McuId } from '@kontrolla/core';

export const pinLabel = (mcu: McuId, p: number): string => {
  const adc = MCUS[mcu].adcPins.includes(p);
  return mcu === 'rp2040-pico' ? `GPIO${p}${adc ? ` (ADC${p - 26})` : ''}` : `Pin ${p}${adc ? ' (analog)' : ''}`;
};

export const pinsOf = (c: Control): number[] =>
  c.kind === 'encoder' ? [c.pinA, c.pinB] : c.kind === 'button' ? [c.pin] : c.pin !== undefined && !c.mux ? [c.pin] : [];

export const labelOf = (c: { id: string; label?: string }): string => c.label || c.id;

/** pin -> who holds it, in an allocated spec. */
export function pinUsers(spec: DeviceSpec): Map<number, string> {
  const m = new Map<number, string>();
  for (const x of spec.muxes) {
    m.set(x.sigPin, `${x.id} signal`);
    x.selectPins.forEach((p, i) => m.set(p, `${x.id} S${i}`));
  }
  for (const c of spec.controls) for (const p of pinsOf(c)) m.set(p, labelOf(c));
  return m;
}
