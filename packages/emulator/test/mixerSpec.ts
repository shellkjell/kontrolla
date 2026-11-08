import type { ButtonControl, Control, DeviceSpec } from '@kontrolla/core';

const cc = (n: number, min = 0, max = 127) => ({ type: 'cc' as const, channel: 1, cc: n, min, max });
const note = (n: number) => ({ type: 'note' as const, channel: 1, note: n, velocity: 100 });
const sel: [number, number, number, number] = [2, 3, 4, 5];
const btn = (id: string, ch: number, mode: 'toggle' | 'momentary', midi: ButtonControl['midi'], led?: { index: number; color: string }): Control =>
  ({ id, kind: 'button', part: 'button-tact-6mm', mux: { id: 'dig', channel: ch }, mode, debounceMs: 3, midi, ...(led && { led }) });

export const mixer: DeviceSpec = {
  version: 1, name: 'mixer', mcu: 'rp2040-pico', usbProductName: 'mixer',
  muxes: [
    { id: 'anaA', part: 'mux-74hc4067', sigPin: 26, selectPins: sel, signal: 'analog' },
    { id: 'anaB', part: 'mux-74hc4067', sigPin: 27, selectPins: sel, signal: 'analog' },
    { id: 'dig', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital' },
  ],
  controls: [
    { id: 'a0', kind: 'pot', part: 'pot-b10k', mux: { id: 'anaA', channel: 0 }, midi: cc(1), deadband: 8, smoothing: 64 },
    { id: 'a1', kind: 'pot', part: 'pot-b10k', mux: { id: 'anaA', channel: 3 }, midi: cc(2), deadband: 8, smoothing: 0 },
    { id: 'b0', kind: 'fader', part: 'fader-60mm', mux: { id: 'anaB', channel: 1 }, midi: cc(3), deadband: 8, smoothing: 128 },
    { id: 'b1', kind: 'fader', part: 'fader-60mm', mux: { id: 'anaB', channel: 2 }, midi: cc(4, 20, 100), deadband: 8, smoothing: 0 },
    btn('mute', 0, 'toggle', note(10), { index: 0, color: '#ff0000' }),
    btn('solo', 1, 'toggle', note(11), { index: 1, color: '#ffc000' }),
    btn('cue', 2, 'momentary', note(12), { index: 2, color: '#00a0ff' }),
    btn('rec', 3, 'momentary', cc(20, 5, 99), { index: 3, color: '#ff00ff' }),
    btn('plain', 15, 'momentary', note(13)),
  ],
  meters: [
    { id: 'm1', part: 'meter-bar', ledStart: 4, ledCount: 10, midi: { channel: 1, cc: 30 } },
    { id: 'm2', part: 'meter-bar', ledStart: 14, ledCount: 8, midi: { channel: 1, cc: 31 } },
  ],
  leds: { part: 'led-ws2812', pin: 16, count: 22, brightness: 200 },
};

