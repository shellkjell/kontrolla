import { MCUS, PARTS } from './catalog';
import type { Control, DeviceSpec } from './types';

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  controlId?: string;
  message: string;
  fix?: string;
}

const isInt = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const CATEGORY: Record<Control['kind'], string> = { pot: 'analog', fader: 'analog', button: 'button', encoder: 'encoder' };

export function validate(spec: DeviceSpec): Issue[] {
  const out: Issue[] = [];
  const add = (severity: Issue['severity'], message: string, controlId?: string, fix?: string) =>
    out.push({ severity, message, ...(controlId !== undefined && { controlId }), ...(fix !== undefined && { fix }) });
  const mcu = MCUS[spec.mcu];

  // name
  if (spec.usbProductName.length > 31) add('error', `usbProductName is ${spec.usbProductName.length} chars (max 31)`, undefined, 'Shorten the name');
  if (!/^[\x20-\x7e]*$/.test(spec.usbProductName)) add('error', 'usbProductName must be printable ASCII', undefined, 'Remove non-ASCII characters');

  // ids
  const ids = new Set<string>();
  for (const c of spec.controls) {
    if (ids.has(c.id)) add('error', `Duplicate control id "${c.id}"`, c.id, 'Give every control a unique id');
    ids.add(c.id);
  }

  // pins: collect usage
  const usage = new Map<number, string[]>();
  const use = (pin: number | undefined, who: string, controlId: string | undefined, label: string) => {
    if (pin === undefined) return add('error', `${label} has no pin assigned`, controlId, 'Run allocatePins');
    usage.set(pin, [...(usage.get(pin) ?? []), who]);
    if (mcu.reserved.includes(pin)) add('error', `Pin ${pin} is reserved on ${mcu.name}`, controlId, 'Use another pin');
    else if (!mcu.usableGpio.includes(pin)) add('error', `Pin ${pin} does not exist / is not usable on ${mcu.name}`, controlId, 'Use another pin');
  };
  const muxIds = new Map(spec.muxes.map((m) => [m.id, m]));
  const selUse = new Map<number, { pos: number; mux: string }>(); // shared select bus: same pin must keep the same S position
  for (const m of spec.muxes) {
    if (muxIds.get(m.id) !== m) add('error', `Duplicate mux id "${m.id}"`, undefined, 'Give every mux a unique id');
    use(m.sigPin, m.id, undefined, `Mux ${m.id} SIG`);
    if (m.signal === 'analog' && !mcu.adcPins.includes(m.sigPin))
      add('error', `Mux ${m.id} SIG pin ${m.sigPin} is not ADC-capable (analog mux)`, undefined, `Use one of ${mcu.adcPins.join(', ')}`);
    else if (m.signal !== 'analog' && m.signal !== 'digital') add('error', `Mux ${m.id} signal must be 'analog' or 'digital'`);
    m.selectPins.forEach((p, i) => {
      const prev = selUse.get(p);
      if (!prev) {
        selUse.set(p, { pos: i, mux: m.id });
        use(p, `${m.id}.S${i}`, undefined, `Mux ${m.id} S${i}`);
      } else if (prev.pos !== i)
        add('error', `Select pin ${p} is S${i} on ${m.id} but S${prev.pos} on ${prev.mux}`, undefined, 'Shared select pins must have the same S position on every mux');
    });
  }

  const muxSlots = new Set<string>();
  for (const c of spec.controls) {
    const label = `Control ${c.id}`;
    if (c.kind === 'encoder') {
      use(c.pinA, c.id, c.id, `${label} pin A`);
      use(c.pinB, c.id, c.id, `${label} pin B`);
    } else if (c.mux) {
      if (c.pin !== undefined) add('warning', `${label} has both a pin and a mux; the pin is ignored`, c.id, 'Remove pin');
      const m = muxIds.get(c.mux.id);
      if (!m) add('error', `${label} references unknown mux "${c.mux.id}"`, c.id, 'Add the mux or fix the id');
      else if ((c.kind === 'button') !== (m.signal === 'digital'))
        add('error', `${label} (${c.kind}) is on ${m.signal} mux ${m.id}`, c.id, c.kind === 'button' ? 'Put buttons on a digital mux' : 'Put pots/faders on an analog mux');
      if (!isInt(c.mux.channel, 0, 15)) add('error', `${label} mux channel ${c.mux.channel} not in 0-15`, c.id);
      const key = `${c.mux.id}:${c.mux.channel}`;
      if (muxSlots.has(key)) add('error', `Mux channel collision: ${key}`, c.id, 'Use a free channel');
      muxSlots.add(key);
    } else if (c.kind === 'button') use(c.pin, c.id, c.id, label);
    else {
      use(c.pin, c.id, c.id, label);
      if (c.pin !== undefined && !mcu.adcPins.includes(c.pin))
        add('error', `${label}: pin ${c.pin} is not ADC-capable`, c.id, `Use ${mcu.adcPins.join(', ')} or put it on a mux`);
    }

    const part = PARTS[c.part];
    if (!part) add('error', `${label}: unknown part "${c.part}"`, c.id);
    else if (part.category !== CATEGORY[c.kind]) add('error', `${label}: part ${c.part} is a ${part.category}, not a ${c.kind}`, c.id);

    const m = c.midi;
    if (!isInt(m.channel, 1, 16)) add('error', `${label}: MIDI channel ${m.channel} not in 1-16`, c.id);
    if (m.type === 'cc') {
      if (!isInt(m.cc, 0, 127)) add('error', `${label}: CC ${m.cc} not in 0-127`, c.id);
      if (!isInt(m.min, 0, 127) || !isInt(m.max, 0, 127)) add('error', `${label}: CC min/max must be 0-127`, c.id);
    } else {
      if (!isInt(m.note, 0, 127)) add('error', `${label}: note ${m.note} not in 0-127`, c.id);
      if (!isInt(m.velocity, 1, 127)) add('error', `${label}: velocity ${m.velocity} not in 1-127`, c.id);
    }
    if (c.kind === 'button' && !isInt(c.debounceMs, 0, 255)) add('error', `${label}: debounceMs not in 0-255`, c.id);
    if (c.kind !== 'encoder' && c.kind !== 'button') {
      if (!isInt(c.deadband, 0, 255)) add('error', `${label}: deadband not in 0-255`, c.id);
      if (!isInt(c.smoothing, 0, 255)) add('error', `${label}: smoothing not in 0-255`, c.id);
      else if (c.deadband < 8) add('warning', `${label}: deadband ${c.deadband} < 8; noisy pots will spam MIDI`, c.id, 'Set deadband to 8 or more');
    }
  }

  // LEDs: chain, button LEDs, meters
  const leds = spec.leds;
  const meters = spec.meters ?? [];
  const claimed = new Map<number, string>();
  const claim = (i: number, who: string) => {
    const prev = claimed.get(i);
    if (prev) add('error', `LED ${i} is claimed by both ${prev} and ${who}`, who, 'Give each button/meter its own LEDs');
    else claimed.set(i, who);
  };
  const count = leds?.count ?? 0;
  if (leds) {
    use(leds.pin, 'leds', undefined, 'LED chain data pin');
    if (!isInt(leds.count, 1, 255)) add('error', `LED count ${leds.count} not in 1-255`);
    if (!isInt(leds.brightness, 0, 255)) add('error', `LED brightness ${leds.brightness} not in 0-255`);
  }
  for (const c of spec.controls) {
    if (c.kind !== 'button' || !c.led) continue;
    if (!leds) add('error', `Button ${c.id} has an LED but the device has no LED chain`, c.id, 'Add an LED chain');
    else if (!isInt(c.led.index, 0, count - 1)) add('error', `Button ${c.id} LED index ${c.led.index} is outside the chain (0-${count - 1})`, c.id);
    else claim(c.led.index, c.id);
    if (!/^#[0-9a-fA-F]{6}$/.test(c.led.color)) add('error', `Button ${c.id} LED color "${c.led.color}" must be #rrggbb`, c.id);
  }
  for (const m of meters) {
    if (ids.has(m.id)) add('error', `Duplicate id "${m.id}"`, m.id, 'Give every control and meter a unique id');
    ids.add(m.id);
    if (!isInt(m.midi.channel, 1, 16)) add('error', `Meter ${m.id}: MIDI channel ${m.midi.channel} not in 1-16`, m.id);
    if (!isInt(m.midi.cc, 0, 127)) add('error', `Meter ${m.id}: CC ${m.midi.cc} not in 0-127`, m.id);
    if (!isInt(m.ledCount, 1, 32)) add('error', `Meter ${m.id}: ledCount ${m.ledCount} not in 1-32`, m.id);
    if (!leds) add('error', `Meter ${m.id} needs an LED chain`, m.id, 'Add an LED chain');
    else if (!isInt(m.ledStart, 0, count - 1) || m.ledStart + m.ledCount > count)
      add('error', `Meter ${m.id} LEDs ${m.ledStart}-${m.ledStart + m.ledCount - 1} are outside the chain (0-${count - 1})`, m.id, 'Lengthen the chain or move the meter');
    else for (let i = 0; i < m.ledCount; i++) claim(m.ledStart + i, m.id);
  }
  if (leds && isInt(leds.count, 1, 255) && isInt(leds.brightness, 0, 255)) {
    // WS2812: ~1 mA idle + up to 60 mA per LED at full white, scaled by brightness. VBUS ~500 mA, 100 mA reserved for the board.
    const BUDGET = 400;
    const worst = count * (1 + (60 * leds.brightness) / 255);
    if (worst > BUDGET) {
      const safe = Math.max(0, Math.floor((255 * (BUDGET / count - 1)) / 60));
      add('warning', `LEDs worst case ~${worst.toFixed(0)} mA from 5 V (budget ${BUDGET} mA of ~500 mA USB, 100 mA reserved)`, undefined,
        `Lower LED brightness to ${safe} or less, or use fewer LEDs / an external 5 V supply`);
    } else add('info', `LEDs worst case ~${worst.toFixed(0)} mA from 5 V (budget ${BUDGET} mA)`);
    add('info', 'WS2812 data wants 5 V logic: add a 74AHCT125 level shifter on the 3V3 data line (or use SK6812, which accepts 3V3 data)');
  }

  for (const [pin, who] of usage)
    if (who.length > 1) add('error', `Pin ${pin} used more than once (${who.join(', ')})`, undefined, 'Give each signal its own pin');

  // duplicate MIDI targets
  const seen = new Map<string, string>();
  for (const c of spec.controls) {
    const m = c.midi;
    const key = m.type === 'cc' ? `cc:${m.channel}:${m.cc}` : `note:${m.channel}:${m.note}`;
    const prev = seen.get(key);
    if (prev) add('warning', `${c.id} sends the same MIDI target as ${prev} (${key})`, c.id, 'Use a different CC/note number');
    else seen.set(key, c.id);
  }

  // 3V3 budget
  const ma = spec.controls.reduce((s, c) => s + (PARTS[c.part]?.currentMa ?? 0), 0) + spec.muxes.length * PARTS['mux-74hc4067']!.currentMa;
  if (ma > mcu.budget3v3Ma) add('error', `3V3 draw ~${ma.toFixed(1)} mA exceeds ${mcu.name} budget ${mcu.budget3v3Ma} mA`, undefined, 'Use fewer parts or an external 3V3 regulator');
  else add('info', `3V3 draw ~${ma.toFixed(1)} mA of ${mcu.budget3v3Ma} mA budget`);
  return out;
}
