// Shared contract. See docs/CONTRACTS.md for semantics. Change only with a contract update.

export type McuId = 'rp2040-pico' | 'teensy41';

export interface CcTarget {
  type: 'cc';
  channel: number; // 1-16
  cc: number; // 0-127
  min: number; // 0-127
  max: number; // 0-127
}

export interface NoteTarget {
  type: 'note';
  channel: number; // 1-16
  note: number; // 0-127
  velocity: number; // 1-127
}

export type MidiTarget = CcTarget | NoteTarget;

export interface AnalogControl {
  id: string;
  kind: 'pot' | 'fader';
  part: string; // catalog part id
  label?: string;
  pin?: number; // MCU pin (RP2040: GPIO 26-28; Teensy: Arduino pin). Omit when on a mux.
  mux?: { id: string; channel: number }; // channel 0-15
  midi: CcTarget;
  deadband: number; // 0-255, raw 12-bit units
  smoothing: number; // 0-255, 0 = none
}

export interface ButtonControl {
  id: string;
  kind: 'button';
  part: string;
  label?: string;
  pin: number;
  midi: MidiTarget;
  mode: 'momentary' | 'toggle';
  debounceMs: number; // 0-255
}

export interface EncoderControl {
  id: string;
  kind: 'encoder';
  part: string;
  label?: string;
  pinA: number;
  pinB: number;
  midi: CcTarget;
  relative: boolean;
}

export type Control = AnalogControl | ButtonControl | EncoderControl;

export interface Mux {
  id: string;
  part: 'mux-74hc4067';
  sigPin: number; // analog-capable MCU pin
  selectPins: [number, number, number, number]; // S0..S3
}

export interface DeviceSpec {
  version: 1;
  name: string;
  mcu: McuId;
  usbProductName: string; // ASCII, max 31 chars
  muxes: Mux[];
  controls: Control[];
}

/** Physical-layer imperfections applied to stimulus. Same seeded model for every sim. */
export interface SimOptions {
  analogNoiseLsb?: number; // peak noise on 12-bit ADC reads, default 0
  buttonBounceMs?: number; // contact bounce duration on each edge, default 0
  seed?: number;
}

/** One implementation per fidelity level: firmware (rp2040js) and model (core). */
export interface DeviceSim {
  readonly fidelity: 'firmware' | 'model';
  setAnalog(controlId: string, value01: number): void;
  setButton(controlId: string, pressed: boolean): void;
  turnEncoder(controlId: string, detents: number): void; // + = clockwise
  advance(ms: number): Promise<void>; // simulated time
  onMidi(cb: (msg: number[], timeMs: number) => void): () => void; // returns unsubscribe
}
