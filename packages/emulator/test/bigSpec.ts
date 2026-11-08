import type { Control, DeviceSpec } from '@kontrolla/core';

const sel: [number, number, number, number] = [2, 3, 4, 5];

/** 59 analog controls on four muxes, two of which share ADC2 through EN: the Portable Mixer 6 scale. */
export const big59: DeviceSpec = {
  version: 1, name: 'big59', mcu: 'rp2040-pico', usbProductName: 'big59',
  muxes: [
    { id: 'A', part: 'mux-74hc4067', sigPin: 26, selectPins: sel, signal: 'analog' },
    { id: 'B', part: 'mux-74hc4067', sigPin: 27, selectPins: sel, signal: 'analog' },
    { id: 'C', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 7 },
    { id: 'D', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 8 },
  ],
  controls: Array.from({ length: 59 }, (_, i): Control => ({
    id: `p${i}`, kind: 'pot', part: 'pot-b10k', mux: { id: 'ABCD'[Math.floor(i / 16)]!, channel: i % 16 },
    midi: { type: 'cc', channel: 1 + (i >> 6), cc: i % 128, min: 0, max: 127 }, deadband: 8, smoothing: 0,
  })),
};
