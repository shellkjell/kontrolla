// Contract v3 differential spec: 4 analog muxes (two share ADC2 through EN), 2 digital muxes sharing a SIG pin through EN,
// everything on one select bus, illuminated buttons, meters, UART MIDI port on UART0 (GPIO0 TX / GPIO1 RX).
import type { ButtonControl, Control, DeviceSpec } from '@kontrolla/core';

const cc = (n: number, min = 0, max = 127) => ({ type: 'cc' as const, channel: 1, cc: n, min, max });
const note = (n: number) => ({ type: 'note' as const, channel: 1, note: n, velocity: 100 });
const sel: [number, number, number, number] = [2, 3, 4, 5];
const btn = (id: string, mux: string, ch: number, mode: 'toggle' | 'momentary', midi: ButtonControl['midi'], led?: { index: number; color: string }): Control =>
  ({ id, kind: 'button', part: 'button-tact-6mm', mux: { id: mux, channel: ch }, mode, debounceMs: 3, midi, ...(led && { led }) });
const pot = (id: string, mux: string, ch: number, n: number, smoothing = 0): Control =>
  ({ id, kind: 'pot', part: 'pot-b10k', mux: { id: mux, channel: ch }, midi: cc(n), deadband: 8, smoothing });

export const mixer3: DeviceSpec = {
  version: 1, name: 'mixer3', mcu: 'rp2040-pico', usbProductName: 'mixer3',
  muxes: [
    { id: 'anaA', part: 'mux-74hc4067', sigPin: 26, selectPins: sel, signal: 'analog' },
    { id: 'anaB', part: 'mux-74hc4067', sigPin: 27, selectPins: sel, signal: 'analog' },
    { id: 'anaC', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 7 },
    { id: 'anaD', part: 'mux-74hc4067', sigPin: 28, selectPins: sel, signal: 'analog', enablePin: 8 },
    { id: 'dig1', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 10 },
    { id: 'dig2', part: 'mux-74hc4067', sigPin: 6, selectPins: sel, signal: 'digital', enablePin: 11 },
  ],
  controls: [
    pot('a0', 'anaA', 0, 1, 64), pot('b0', 'anaB', 0, 2), pot('c0', 'anaC', 0, 3), pot('d0', 'anaD', 0, 4, 128), // same channel 0 on every mux
    pot('c5', 'anaC', 5, 5), pot('d5', 'anaD', 5, 6),
    btn('mute', 'dig1', 0, 'toggle', note(10), { index: 0, color: '#ff0000' }),
    btn('solo', 'dig2', 0, 'toggle', note(11), { index: 1, color: '#ffc000' }), // same channel 0 on both digital muxes
    btn('cue', 'dig1', 4, 'momentary', note(12), { index: 2, color: '#00a0ff' }),
    btn('rec', 'dig2', 4, 'momentary', cc(20, 5, 99), { index: 3, color: '#ff00ff' }),
  ],
  meters: [
    { id: 'm1', part: 'meter-bar', ledStart: 4, ledCount: 10, midi: { channel: 1, cc: 30 } },
    { id: 'm2', part: 'meter-bar', ledStart: 14, ledCount: 8, midi: { channel: 1, cc: 31 } },
  ],
  leds: { part: 'led-ws2812', pin: 16, count: 22, brightness: 200 },
  midiPort: { part: 'midi-trs-a', txPin: 0, rxPin: 1 },
};
