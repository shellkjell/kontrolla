import { MCUS } from './catalog';
import type { AnalogControl, ButtonControl, DeviceSpec, Mux } from './types';

/** [TX, RX] pairs the UART peripherals can use. RP2040: UART0 GP0/1, 12/13, 16/17; UART1 GP4/5, 8/9. Teensy 4.1: Serial1, 2, 4, 5. */
const UART_PAIRS_PICO: [number, number][] = [[0, 1], [12, 13], [16, 17], [4, 5], [8, 9]];
const UART_PAIRS_TEENSY: [number, number][] = [[1, 0], [8, 7], [17, 16], [20, 21]];

const isAnalog = (c: { kind: string }): c is AnalogControl => c.kind === 'pot' || c.kind === 'fader';

/** Fill missing pins/mux slots. Deterministic; respects manual pins; leaves pins unset if the MCU runs out.
 *  Muxes share ONE select bus (the first mux's S0..S3). Analog overflow -> analog muxes; if the buttons do not
 *  all fit on direct pins they ALL go on digital muxes. Teensy has plenty of pins, so it stays direct. */
export function allocatePins(input: DeviceSpec): DeviceSpec {
  const spec = structuredClone(input);
  const mcu = MCUS[spec.mcu];
  const used = new Set<number>();
  for (const m of spec.muxes) [m.sigPin, ...m.selectPins].forEach((p) => used.add(p));
  if (spec.leds?.pin !== undefined) used.add(spec.leds.pin);
  for (const c of spec.controls) {
    if (c.kind === 'encoder') {
      if (c.pinA !== undefined) used.add(c.pinA);
      if (c.pinB !== undefined) used.add(c.pinB);
    } else if (c.pin !== undefined) used.add(c.pin);
  }

  const digital = () =>
    mcu.usableGpio.filter((p) => !used.has(p)).sort((a, b) => Number(mcu.adcPins.includes(a)) - Number(mcu.adcPins.includes(b)) || a - b);
  const take = (): number | undefined => {
    const p = digital()[0];
    if (p !== undefined) used.add(p);
    return p;
  };

  // ---- hardware MIDI port: a legal UART pin pair (TX, RX), picked before anything else grabs the low pins ----
  if (spec.midiPort) {
    if (spec.midiPort.txPin !== undefined) used.add(spec.midiPort.txPin);
    if (spec.midiPort.rxPin !== undefined) used.add(spec.midiPort.rxPin);
    if (spec.midiPort.txPin === undefined && spec.midiPort.rxPin === undefined) {
      const pairs = spec.mcu === 'rp2040-pico' ? UART_PAIRS_PICO : UART_PAIRS_TEENSY;
      const pair = pairs.find(([tx, rx]) => [tx, rx].every((p) => mcu.usableGpio.includes(p) && !mcu.reserved.includes(p) && !used.has(p)));
      if (pair) {
        [spec.midiPort.txPin, spec.midiPort.rxPin] = pair;
        pair.forEach((p) => used.add(p));
      }
    }
  }

  // ---- analog ----
  const freeAdc = mcu.adcPins.filter((p) => !used.has(p));
  const need = spec.controls.filter((c): c is AnalogControl => isAnalog(c) && c.pin === undefined && !c.mux);
  const aSlots: { id: string; ch: number }[] = [];
  const dSlots: { id: string; ch: number }[] = [];
  const occupied = new Set(spec.controls.flatMap((c) => (c.kind === 'encoder' || !c.mux ? [] : [`${c.mux.id}:${c.mux.channel}`])));
  const addSlotsFor = (m: Mux) => {
    for (let ch = 0; ch < 16; ch++) if (!occupied.has(`${m.id}:${ch}`)) (m.signal === 'digital' ? dSlots : aSlots).push({ id: m.id, ch });
  };
  spec.muxes.forEach(addSlotsFor);

  // Overflow beyond direct ADC pins goes to mux slots; each new mux costs one ADC pin.
  let d = Math.min(need.length, freeAdc.length);
  let newMuxes = 0;
  while (need.length - d > aSlots.length + 16 * newMuxes && d > 0) (d--, newMuxes++);
  // Still short with every ADC pin on a mux: extra muxes share a SIG pin and tell themselves apart by their EN pin.
  const short = need.length - d - aSlots.length - 16 * newMuxes;
  if (short > 0 && freeAdc.length > 0) newMuxes += Math.ceil(short / 16);
  const pool = freeAdc.slice(d);
  const sigs = Array.from({ length: pool.length ? newMuxes : 0 }, (_, i) => pool[i % pool.length]!);
  [...freeAdc.slice(0, d), ...sigs].forEach((p) => used.add(p));
  const shared = (i: number) => sigs.filter((p) => p === sigs[i]).length > 1;
  const enNeeded = sigs.filter((_, i) => shared(i)).length;

  // ---- buttons: direct pins or digital muxes ----
  const btns = spec.controls.filter((c): c is ButtonControl => c.kind === 'button' && c.pin === undefined && !c.mux);
  const encPins = spec.controls.reduce((n, c) => n + (c.kind === 'encoder' ? Number(c.pinA === undefined) + Number(c.pinB === undefined) : 0), 0);
  const busPins = spec.muxes.length > 0 ? 0 : 4;
  const ledPin = spec.leds && spec.leds.pin === undefined ? 1 : 0;
  const freeNow = digital().length - (sigs.length > 0 ? busPins : 0) - enNeeded - ledPin - encPins;
  const dSigs = btns.length > freeNow ? Math.max(0, Math.ceil((btns.length - dSlots.length) / 16)) : 0;
  const bus = (): [number, number, number, number] | undefined => {
    const first = spec.muxes[0];
    if (first) return first.selectPins;
    const sel = [take(), take(), take(), take()];
    return sel.some((s) => s === undefined) ? undefined : (sel as [number, number, number, number]);
  };

  const newMux = (sigPin: number, signal: Mux['signal'], sel: [number, number, number, number], enablePin?: number) => {
    let n = spec.muxes.filter((m) => m.signal === signal).length + 1;
    const prefix = signal === 'digital' ? 'dmux' : 'mux';
    while (spec.muxes.some((m) => m.id === `${prefix}${n}`)) n++;
    const m: Mux = { id: `${prefix}${n}`, part: 'mux-74hc4067', sigPin, selectPins: sel, signal, ...(enablePin !== undefined && { enablePin }) };
    spec.muxes.push(m);
    addSlotsFor(m);
  };

  const sel = sigs.length + dSigs > 0 ? bus() : undefined;
  if (sel) {
    sigs.forEach((sigPin, i) => newMux(sigPin, 'analog', sel, shared(i) ? take() : undefined));
    for (let i = 0; i < dSigs; i++) {
      const sigPin = take();
      if (sigPin === undefined) break;
      newMux(sigPin, 'digital', sel);
    }
  }

  need.forEach((c, i) => {
    const direct = freeAdc[i];
    if (i < d && direct !== undefined) c.pin = direct;
    else {
      const s = aSlots.shift();
      if (s) c.mux = { id: s.id, channel: s.ch };
    }
  });

  if (spec.leds && spec.leds.pin === undefined) {
    const p = take();
    if (p !== undefined) spec.leds.pin = p;
  }

  for (const c of spec.controls) {
    if (c.kind === 'button' && c.pin === undefined && !c.mux) {
      const s = btns.length > freeNow ? dSlots.shift() : undefined;
      if (s) c.mux = { id: s.id, channel: s.ch };
      else {
        const p = take();
        if (p !== undefined) c.pin = p;
      }
    } else if (c.kind === 'encoder') {
      if (c.pinA === undefined) c.pinA = take();
      if (c.pinB === undefined) c.pinB = take();
    }
  }
  return allocateLeds(spec);
}

/** Give button LEDs and meters their place in the WS2812 chain. A missing index/start is < 0 (or the button has led set to -1).
 *  Order = groups in order, members in order, then ungrouped buttons, then ungrouped meters, so the data line runs
 *  group by group (strip by strip). Already-assigned ranges are kept; new ones take the first free gap. Creates/grows spec.leds. */
export function allocateLeds(input: DeviceSpec): DeviceSpec {
  const spec = structuredClone(input);
  const meters = spec.meters ?? [];
  const byId = new Map<string, { size: number; set: (start: number) => void; start: number }>();
  for (const c of spec.controls)
    if (c.kind === 'button' && c.led) {
      const led = c.led;
      byId.set(c.id, { size: 1, start: led.index, set: (s) => (led.index = s) });
    }
  for (const m of meters) byId.set(m.id, { size: m.ledCount, start: m.ledStart, set: (s) => (m.ledStart = s) });

  const order: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => byId.has(id) && !seen.has(id) && (seen.add(id), order.push(id));
  for (const g of spec.groups ?? []) g.members.forEach(push);
  spec.controls.forEach((c) => push(c.id));
  meters.forEach((m) => push(m.id));

  const taken = new Set<number>();
  for (const e of byId.values()) if (e.start >= 0) for (let i = 0; i < e.size; i++) taken.add(e.start + i);
  for (const id of order) {
    const e = byId.get(id)!;
    if (e.start >= 0) continue;
    let s = 0;
    const fits = () => Array.from({ length: e.size }, (_, i) => s + i).every((i) => !taken.has(i));
    while (!fits()) s++;
    for (let i = 0; i < e.size; i++) taken.add(s + i);
    e.set(s);
  }

  if (byId.size === 0) return spec;
  const need = taken.size ? Math.max(...taken) + 1 : 0;
  if (spec.leds) spec.leds.count = Math.max(spec.leds.count, need);
  else spec.leds = { part: 'led-ws2812', count: need, brightness: 64 };
  return spec;
}
