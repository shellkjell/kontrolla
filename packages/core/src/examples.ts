// Example specs with groups and a computed panel layout. Pins are not allocated: run allocatePins() to fill them.
import { allocateLeds } from './allocate';
import { createGroup, duplicateGroup } from './groups';
import { autoLayout } from './layout';
import type { AnalogControl, ButtonControl, Control, DeviceSpec, EncoderControl, Meter } from './types';

const finish = (spec: DeviceSpec): DeviceSpec => ({ ...spec, layout: autoLayout(spec) });

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

const ids = (prefix: string, n: number) => seq(n).map((i) => `${prefix}${i}`);
const section = (spec: DeviceSpec, label: string, members: string[]) => createGroup(spec, label, members, { kind: 'section' });

const starter = section(
  section(
    {
      // Note: Pico has only 3 ADC pins, so allocatePins puts the 4th pot on an auto-added mux.
      version: 1, name: 'Starter', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Starter', muxes: [],
      controls: [...seq(4).map((i) => pot(i, 20 + i)), ...seq(4).map((i) => btn(i, 35 + i))],
    },
    'Knobs', ids('pot', 4),
  ),
  'Pads', ids('btn', 4),
);

const bigKnobs = section(
  section(
    {
      version: 1, name: 'Big Knobs', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Big Knobs', muxes: [],
      controls: [...seq(12).map((i) => pot(i, 20 + i)), enc(1, 60, false), enc(2, 61, true)],
    },
    'Knobs', ids('pot', 12),
  ),
  'Encoders', ids('enc', 2),
);

const teensyMixer = section(
  section(
    section(
      {
        version: 1, name: 'Teensy Mixer', mcu: 'teensy41', usbProductName: 'kont.rolla Teensy Mixer', muxes: [],
        controls: [
          ...seq(6).map((i) => ({ ...pot(i, 20 + i), kind: 'fader' as const, part: 'fader-60mm-b10k' })),
          enc(1, 60, true), enc(2, 61, false), ...seq(4).map((i) => btn(i, 35 + i)),
        ],
      },
      'Faders', ids('pot', 6),
    ),
    'Encoders', ids('enc', 2),
  ),
  'Pads', ids('btn', 4),
);

// ---- Portable Mixer 6 (Pico) ------------------------------------------------------------------------------
// All on MIDI channel 1. Strip n (1..6) has a block of 8 CCs and 3 notes; duplicateGroup() shifts them by the block size.
//
//   control            strip 1   strip n          type
//   gain               CC 12     CC 12+8(n-1)     pot
//   hi / mid / lo EQ   13/14/15  +8(n-1)          pot
//   FX send            CC 16     +8(n-1)          pot
//   pan                CC 17     +8(n-1)          pot
//   fader              CC 18     +8(n-1)          60 mm fader
//   meter (DAW->dev)   CC 19     +8(n-1)          8 LEDs, level from the DAW
//   mute               note 24   +3(n-1)          toggle, LED = state (DAW feedback overrides)
//   solo               note 25   +3(n-1)          toggle, LED = state (DAW feedback overrides)
//   cue                note 26   +3(n-1)          toggle, LED = state
//   master fader CC 70 | booth/phones CC 71 | cue mix CC 72 | FX return CC 73 | FX select encoder CC 74 (relative)
//   master meters L/R (DAW->dev) CC 76 / 77 | tap tempo note 60 | FX select push note 61
//
// Budget: 6*7 + 4 = 46 analog -> 3 analog muxes (48 slots) on the shared select bus; 20 buttons -> digital muxes;
// 83 LEDs (6*(3+8) + 1 + 16). Brightness 16/255 keeps the worst case (all white) well inside USB's 500 mA.
const analog = (id: string, label: string, part: string, cc: number, kind: 'pot' | 'fader' = 'pot'): AnalogControl => ({
  id, kind, part, label, midi: { type: 'cc', channel: 1, cc, min: 0, max: 127 }, deadband: 12, smoothing: 64,
});
const ledBtn = (id: string, label: string, note: number, color: string, mode: 'toggle' | 'momentary'): ButtonControl => ({
  id, kind: 'button', part: 'button-led-12mm', label, midi: { type: 'note', channel: 1, note, velocity: 100 }, mode, debounceMs: 5,
  led: { index: -1, color },
});
const meter = (id: string, label: string, cc: number): Meter => ({
  id, part: 'meter-led-bar', label, ledStart: -1, ledCount: 8, midi: { channel: 1, cc },
});
const STRIP_COLORS = ['#e05555', '#e08a3c', '#d4b83a', '#4caf6a', '#3c8fe0', '#9b6be0'];

const ch1: { controls: Control[]; meters: Meter[] } = {
  controls: [
    analog('ch1-gain', 'Gain', 'pot-b10k', 12), analog('ch1-hi', 'Hi', 'pot-b10k', 13), analog('ch1-mid', 'Mid', 'pot-b10k', 14),
    analog('ch1-lo', 'Lo', 'pot-b10k', 15), analog('ch1-fx', 'FX', 'pot-b10k', 16), analog('ch1-pan', 'Pan', 'pot-b10k', 17),
    ledBtn('ch1-mute', 'Mute', 24, '#ff2020', 'toggle'), ledBtn('ch1-solo', 'Solo', 25, '#ffc000', 'toggle'), ledBtn('ch1-cue', 'Cue', 26, '#2090ff', 'toggle'),
    analog('ch1-fader', 'Level', 'fader-60mm-b10k', 18, 'fader'),
  ],
  meters: [meter('ch1-meter', 'Level', 19)],
};
const masterControls = [
  analog('master-fader', 'Master', 'fader-60mm-b10k', 70, 'fader'), analog('booth', 'Booth', 'pot-b10k', 71),
  analog('cue-mix', 'Cue mix', 'pot-b10k', 72), analog('fx-return', 'FX return', 'pot-b10k', 73),
  { id: 'fx-select', kind: 'encoder', part: 'encoder-ec11-push', label: 'FX select', midi: { type: 'cc', channel: 1, cc: 74, min: 0, max: 127 }, relative: true } as EncoderControl,
  { id: 'fx-select-push', kind: 'button', part: 'button-encoder-push', label: 'FX select push', midi: { type: 'note', channel: 1, note: 61, velocity: 100 }, mode: 'momentary', debounceMs: 5 } as ButtonControl,
  ledBtn('tap', 'Tap tempo', 60, '#ffffff', 'momentary'),
];

let mixer: DeviceSpec = {
  version: 1, name: 'Portable Mixer 6', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Mixer 6', muxes: [],
  controls: [...ch1.controls, ...masterControls],
  meters: [...ch1.meters, meter('master-meter-l', 'Master L', 76), meter('master-meter-r', 'Master R', 77)],
  leds: { part: 'led-ws2812', count: 1, brightness: 16 },
};
mixer = createGroup(mixer, 'Ch 1', [...ch1.controls.map((c) => c.id), 'ch1-meter'], { id: 'ch1', kind: 'strip', color: STRIP_COLORS[0] });
mixer = createGroup(mixer, 'Master', [...masterControls.map((c) => c.id), 'master-meter-l', 'master-meter-r'], { id: 'master', kind: 'section', color: '#8899aa' });
mixer = duplicateGroup(mixer, 'ch1', 5);
mixer.groups!.filter((g) => g.kind === 'strip').forEach((g, i) => (g.color = STRIP_COLORS[i]));
mixer = allocateLeds(mixer);

export const EXAMPLES: Record<string, DeviceSpec> = {
  starter: finish(starter),
  'big-knobs': finish(bigKnobs),
  'teensy-mixer': finish(teensyMixer),
  'mixer-6ch': finish(mixer),
};
