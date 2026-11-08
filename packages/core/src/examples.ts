// Unallocated example specs: run allocatePins() to fill pins.
import type { AnalogControl, ButtonControl, DeviceSpec, EncoderControl } from './types';

const pot = (i: number, cc: number): AnalogControl => ({
  id: `pot${i}`, kind: 'pot', part: 'pot-b10k', label: `Knob ${i}`,
  midi: { type: 'cc', channel: 1, cc, min: 0, max: 127 }, deadband: 12, smoothing: 64,
});
const btn = (i: number, note: number): ButtonControl => ({
  id: `btn${i}`, kind: 'button', part: 'button-tact-6mm', label: `Pad ${i}`,
  midi: { type: 'note', channel: 1, note, velocity: 100 }, mode: 'momentary', debounceMs: 5,
} as ButtonControl);
const enc = (i: number, cc: number, relative: boolean): EncoderControl => ({
  id: `enc${i}`, kind: 'encoder', part: 'encoder-ec11', label: `Encoder ${i}`,
  midi: { type: 'cc', channel: 1, cc, min: 0, max: 127 }, relative,
} as EncoderControl);
const seq = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

export const EXAMPLES: Record<string, DeviceSpec> = {
  // Note: Pico has only 3 ADC pins, so allocatePins puts the 4th pot on an auto-added mux.
  starter: {
    version: 1, name: 'Starter', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Starter', muxes: [],
    controls: [...seq(4).map((i) => pot(i, 20 + i)), ...seq(4).map((i) => btn(i, 35 + i))],
  },
  'big-knobs': {
    version: 1, name: 'Big Knobs', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Big Knobs', muxes: [],
    controls: [...seq(12).map((i) => pot(i, 20 + i)), enc(1, 60, false), enc(2, 61, true)],
  },
  'teensy-mixer': {
    version: 1, name: 'Teensy Mixer', mcu: 'teensy41', usbProductName: 'kont.rolla Teensy Mixer', muxes: [],
    controls: [
      ...seq(6).map((i) => ({ ...pot(i, 20 + i), kind: 'fader' as const, part: 'fader-60mm-b10k' })),
      enc(1, 60, true), enc(2, 61, false), ...seq(4).map((i) => btn(i, 35 + i)),
    ],
  },
};
