import { MCUS } from '@kontrolla/core';
import type { Control, DeviceSpec, McuId } from '@kontrolla/core';

export const pinLabel = (mcu: McuId, p: number): string => {
  const adc = MCUS[mcu].adcPins.includes(p);
  return mcu === 'rp2040-pico' ? `GPIO${p}${adc ? ` (ADC${p - 26})` : ''}` : `Pin ${p}${adc ? ' (analog)' : ''}`;
};

/** MCU pins a control owns. Controls on a mux (or not yet allocated) own none; the mux holds the pin. */
export const pinsOf = (c: Control): number[] =>
  (c.kind === 'encoder' ? [c.pinA, c.pinB] : c.mux ? [] : [c.pin]).filter((p): p is number => p !== undefined);

export const labelOf = (c: { id: string; label?: string }): string => c.label || c.id;

/** pin -> who holds it, in an allocated spec. */
export function pinUsers(spec: DeviceSpec): Map<number, string> {
  const m = new Map<number, string>();
  for (const x of spec.muxes) {
    m.set(x.sigPin, `${x.id} signal`);
    x.selectPins.forEach((p, i) => m.set(p, `${x.id} S${i}`));
  }
  if (spec.leds?.pin !== undefined) m.set(spec.leds.pin, 'LED chain');
  for (const c of spec.controls) for (const p of pinsOf(c)) m.set(p, labelOf(c));
  return m;
}
