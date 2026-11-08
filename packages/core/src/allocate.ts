import { MCUS } from './catalog';
import type { AnalogControl, DeviceSpec } from './types';

const isAnalog = (c: { kind: string }): c is AnalogControl => c.kind === 'pot' || c.kind === 'fader';

/** Fill missing pins. Deterministic; leaves pins unset if the MCU runs out. */
export function allocatePins(input: DeviceSpec): DeviceSpec {
  const spec = structuredClone(input);
  const mcu = MCUS[spec.mcu];
  const used = new Set<number>();
  for (const m of spec.muxes) [m.sigPin, ...m.selectPins].forEach((p) => used.add(p));
  for (const c of spec.controls) {
    if (c.kind === 'encoder') (used.add(c.pinA), used.add(c.pinB));
    else if (c.pin !== undefined) used.add(c.pin);
  }

  const freeAdc = mcu.adcPins.filter((p) => !used.has(p));
  const need = spec.controls.filter((c): c is AnalogControl => isAnalog(c) && c.pin === undefined && !c.mux);
  const slots: { id: string; ch: number }[] = [];
  for (const m of spec.muxes)
    for (let ch = 0; ch < 16; ch++)
      if (!spec.controls.some((c) => isAnalog(c) && c.mux?.id === m.id && c.mux.channel === ch)) slots.push({ id: m.id, ch });

  // Overflow beyond direct ADC pins goes to mux slots; each new mux costs one ADC pin.
  let d = Math.min(need.length, freeAdc.length);
  let newMuxes = 0;
  while (need.length - d > slots.length + 16 * newMuxes && d > 0) (d--, newMuxes++);
  const sigs = freeAdc.slice(d, d + newMuxes);
  [...freeAdc.slice(0, d), ...sigs].forEach((p) => used.add(p));

  const digital = () =>
    mcu.usableGpio.filter((p) => !used.has(p)).sort((a, b) => Number(mcu.adcPins.includes(a)) - Number(mcu.adcPins.includes(b)) || a - b);
  const take = (): number | undefined => {
    const p = digital()[0];
    if (p !== undefined) used.add(p);
    return p;
  };

  for (const sigPin of sigs) {
    const sel = [take(), take(), take(), take()];
    if (sel.some((s) => s === undefined)) break;
    let n = spec.muxes.length + 1;
    while (spec.muxes.some((m) => m.id === `mux${n}`)) n++;
    const id = `mux${n}`;
    spec.muxes.push({ id, part: 'mux-74hc4067', sigPin, selectPins: sel as [number, number, number, number] });
    for (let ch = 0; ch < 16; ch++) slots.push({ id, ch });
  }

  need.forEach((c, i) => {
    const direct = freeAdc[i];
    if (i < d && direct !== undefined) c.pin = direct;
    else {
      const s = slots.shift();
      if (s) c.mux = { id: s.id, channel: s.ch };
    }
  });

  for (const c of spec.controls) {
    if (c.kind === 'button' && c.pin === undefined) c.pin = take() as number;
    else if (c.kind === 'encoder') {
      if (c.pinA === undefined) c.pinA = take() as number;
      if (c.pinB === undefined) c.pinB = take() as number;
    }
  }
  return spec;
}
