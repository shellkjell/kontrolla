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
          ...seq(6).map((i) => ({ ...pot(i, 20 + i), kind: 'fader' as const, part: 'fader-60mm-b10k', label: `Fader ${i}` })),
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
// Stereo channels. Everything on MIDI channel 1. Strip n (1..6) owns a block of 10 CCs and 4 notes; duplicateGroup()
// shifts them by the block size, so strip n = strip 1 + 10(n-1) CCs / + 4(n-1) notes.
//
//   control (per strip)     strip 1     type
//   GAIN (trim)             CC 12       pot
//   EQ HI / HI-MID /        CC 13 / 14 / centre-detent pots (64 = flat)
//      LO-MID / LO             15 / 16
//   FILTER                  CC 17       centre-detent pot: left = low-pass, right = high-pass, 64 = off
//   FX SEND                 CC 18       pot
//   PAN / BALANCE           CC 19       centre-detent pot (balance, the channel is stereo)
//   fader                   CC 20       60 mm fader
//   level meter (DAW->dev)  CC 21       12 LEDs beside the fader, levels from the DAW / audio engine
//   INPUT A/B               note 24     toggle, LED = state (DAW feedback overrides)
//   CUE                     note 25     toggle, LED = state
//   MUTE                    note 26     toggle, LED = state
//   SOLO                    note 27     toggle, LED = state
//
//   master: fader CC 72 | booth CC 73 | phones CC 74 | cue mix CC 75 | FX return CC 76 | FX select encoder CC 77 (relative)
//           master meters L / R (DAW->dev) CC 78 / 79, 12 LEDs each, beside the fader
//           tap tempo note 60 | FX select push note 61
//   Hardware MIDI: TRS-A jack on the rear wall, mirrors USB MIDI.
//
// Budget: 6*9 + 5 = 59 analog -> 4 muxes (64 slots) on the shared select bus; muxes 1 and 4 share an ADC pin and are told apart by
// their EN pins. 26 buttons -> 2 digital muxes. 6*(4+12) + 1 + 24 = 121 LEDs. Brightness 9/255 keeps the all-white worst case
// (~380 mA) inside USB's budget; single-colour LEDs at this level are still easy to see indoors.
const analog = (id: string, label: string, part: string, cc: number, kind: 'pot' | 'fader' = 'pot'): AnalogControl => ({
  id, kind, part, label, midi: { type: 'cc', channel: 1, cc, min: 0, max: 127 }, deadband: 12, smoothing: 64,
});
const ledBtn = (id: string, label: string, note: number, color: string, mode: 'toggle' | 'momentary'): ButtonControl => ({
  id, kind: 'button', part: 'button-led-12mm', label, midi: { type: 'note', channel: 1, note, velocity: 100 }, mode, debounceMs: 5,
  led: { index: -1, color },
});
const meter = (id: string, label: string, cc: number): Meter => ({
  id, part: 'meter-led-bar', label, ledStart: -1, ledCount: 12, midi: { channel: 1, cc },
});
const STRIP_COLORS = ['#e05555', '#e08a3c', '#d4b83a', '#4caf6a', '#3c8fe0', '#9b6be0'];

const POT = 'pot-b10k';
const DETENT = 'pot-b10k-detent';
const ch1: { controls: Control[]; meters: Meter[] } = {
  controls: [
    analog('ch1-gain', 'Gain', POT, 12), analog('ch1-hi', 'Hi', DETENT, 13), analog('ch1-himid', 'Hi-mid', DETENT, 14),
    analog('ch1-lomid', 'Lo-mid', DETENT, 15), analog('ch1-lo', 'Lo', DETENT, 16), analog('ch1-filter', 'Filter', DETENT, 17),
    analog('ch1-fx', 'FX', POT, 18), analog('ch1-pan', 'Pan / Bal', DETENT, 19),
    ledBtn('ch1-input', 'A/B', 24, '#ff9a00', 'toggle'), ledBtn('ch1-cue', 'Cue', 25, '#2090ff', 'toggle'),
    ledBtn('ch1-mute', 'Mute', 26, '#ff2020', 'toggle'), ledBtn('ch1-solo', 'Solo', 27, '#ffc000', 'toggle'),
    analog('ch1-fader', 'Level', 'fader-60mm-b10k', 20, 'fader'),
  ],
  meters: [meter('ch1-meter', 'Level', 21)],
};
const masterControls = [
  analog('booth', 'Booth', POT, 73), analog('phones', 'Phones', POT, 74), analog('cue-mix', 'Cue mix', DETENT, 75), analog('fx-return', 'FX return', POT, 76),
  { id: 'fx-select', kind: 'encoder', part: 'encoder-ec11-push', label: 'FX select', midi: { type: 'cc', channel: 1, cc: 77, min: 0, max: 127 }, relative: true } as EncoderControl,
  { id: 'fx-select-push', kind: 'button', part: 'button-encoder-push', label: 'FX select push', midi: { type: 'note', channel: 1, note: 61, velocity: 100 }, mode: 'momentary', debounceMs: 5 } as ButtonControl,
  ledBtn('tap', 'Tap tempo', 60, '#ffffff', 'momentary'),
  analog('master-fader', 'Master', 'fader-60mm-b10k', 72, 'fader'),
];

let mixer: DeviceSpec = {
  version: 1, name: 'Portable Mixer 6', mcu: 'rp2040-pico', usbProductName: 'kont.rolla Mixer 6', muxes: [],
  controls: [...ch1.controls, ...masterControls],
  meters: [...ch1.meters, meter('master-meter-l', 'Master L', 78), meter('master-meter-r', 'Master R', 79)],
  leds: { part: 'led-ws2812', count: 1, brightness: 9 },
  midiPort: { part: 'midi-trs-a' },
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
