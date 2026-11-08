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
  pin?: number; // GPIO; omit when on a digital mux (allocatePins fills it)
  mux?: { id: string; channel: number }; // on a mux with signal 'digital'
  midi: MidiTarget;
  mode: 'momentary' | 'toggle';
  debounceMs: number; // 0-255
  /** Illuminated button: index into spec.leds chain. Shows the button's state; incoming MIDI on its target overrides it (DAW feedback). */
  led?: { index: number; color: string }; // color '#rrggbb'
}

export interface EncoderControl {
  id: string;
  kind: 'encoder';
  part: string;
  label?: string;
  pinA?: number;
  pinB?: number;
  midi: CcTarget;
  relative: boolean;
}

export type Control = AnalogControl | ButtonControl | EncoderControl;

export interface Mux {
  id: string;
  part: 'mux-74hc4067';
  sigPin: number; // analog: ADC-capable pin; digital: any GPIO (read with pull-up)
  /** S0..S3. Muxes MAY share the same select pins (a shared select bus). */
  selectPins: [number, number, number, number];
  signal: 'analog' | 'digital'; // analog carries pots/faders, digital carries buttons
  /** Active-low EN (74HC4067 pin 15). Lets several muxes share one sigPin: only the mux being read is enabled. */
  enablePin?: number;
}

/** Hardware MIDI port (UART, 31250 baud). Mirrors every outgoing message; incoming messages get the same feedback semantics as USB. */
export interface MidiPort {
  part: string; // catalog: 'midi-trs-a' | 'midi-din5'
  txPin?: number; // UART TX
  rxPin?: number; // UART RX (optional: out-only port)
}

/** One WS2812/SK6812 chain (GRB, 800 kHz), powered from 5 V VBUS. */
export interface LedChain {
  part: 'led-ws2812';
  pin?: number;
  count: number; // 1-255
  brightness: number; // 0-255 global scale
}

/** LED bar driven by incoming CC (DAW sends levels). Occupies leds [ledStart, ledStart+ledCount). */
export interface Meter {
  id: string;
  part: string; // catalog part id (physical bar footprint)
  label?: string;
  ledStart: number;
  ledCount: number; // 1-32
  midi: { channel: number; cc: number }; // input: channel 1-16, cc 0-127
}

/** Belonging/togetherness: e.g. a channel strip. Members are control or meter ids; a member is in at most one group. */
export interface Group {
  id: string;
  label: string;
  color?: string; // '#rrggbb'
  kind?: 'strip' | 'section';
  members: string[];
}

/** Physical placement of a control/meter centre on the top panel, in mm. Origin top-left, +x right, +y towards the player. */
export interface Placement {
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
}

/** Free sketch / silkscreen marks on the panel (mm). */
export type Annotation =
  | { id: string; kind: 'text'; x: number; y: number; text: string; size?: number }
  | { id: string; kind: 'stroke'; points: [number, number][] }
  | { id: string; kind: 'rect'; x: number; y: number; w: number; h: number };

export interface Layout {
  panel: { width: number; depth: number; height: number; thickness: number; cornerRadius: number }; // mm; height = enclosure height
  placements: Record<string, Placement>; // by control/meter id
  annotations: Annotation[];
}

export interface DeviceSpec {
  version: 1;
  name: string;
  mcu: McuId;
  usbProductName: string; // ASCII, max 31 chars
  muxes: Mux[];
  controls: Control[];
  leds?: LedChain;
  midiPort?: MidiPort;
  meters?: Meter[];
  groups?: Group[];
  layout?: Layout;
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
  /** Host → device MIDI (DAW feedback: meters, mute/solo state). */
  sendMidi(msg: number[]): void;
  /** Scaled RGB per LED (length = leds.count*3) whenever the chain is refreshed. */
  onLeds(cb: (rgb: Uint8Array, timeMs: number) => void): () => void;
}
