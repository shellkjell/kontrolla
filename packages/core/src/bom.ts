import { MCUS, PARTS, adcChannel } from './catalog';
import { cutoutsOf } from './layout';
import type { Control, DeviceSpec } from './types';

export interface BomItem {
  part: string; // catalog id
  partNumber: string;
  qty: number;
  notes: string;
  unitUsd: number; // approximate single-unit price
  totalUsd: number;
  /** Shop search pages (no API, just a search by part number). Absent for free/virtual items. */
  links?: { mouser: string; digikey: string };
}
export interface WiringRow {
  control: string; // control id (with label), meter id, or mux id
  group?: string; // group label; rows are ordered group by group
  connections: string[];
}
export interface Bom {
  items: BomItem[];
  wiring: WiringRow[];
  totalUsd: number;
}
export interface BuildStep {
  title: string;
  details: string[];
}

const shop = (partNumber: string) => ({
  mouser: `https://www.mouser.com/c/?q=${encodeURIComponent(partNumber)}`,
  digikey: `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(partNumber)}`,
});
const round2 = (n: number) => Math.round(n * 100) / 100;

function pinNames(spec: DeviceSpec) {
  const pico = spec.mcu === 'rp2040-pico';
  const pin = (p: number | undefined) => (p === undefined ? 'UNASSIGNED' : pico ? `GPIO${p}` : `pin ${p}`);
  const adcPin = (p: number | undefined) => (pico && p !== undefined ? `${pin(p)} (ADC${adcChannel(p)})` : pin(p));
  return { pico, pin, adcPin, v: pico ? '3V3(OUT)' : '3.3V' };
}

function controlWiring(spec: DeviceSpec, c: Control): string[] {
  const { pin, adcPin, v } = pinNames(spec);
  if (c.kind === 'button') {
    const where = c.mux ? `mux ${c.mux.id} channel C${c.mux.channel}` : pin(c.pin);
    const out = [`one leg -> ${where}`, 'other leg -> GND', c.mux ? 'no resistor needed (pull-up on the mux SIG pin)' : 'no resistor needed (internal pull-up)'];
    if (c.led) out.push(`LED #${c.led.index} in the LED chain (see the LED step)`);
    return out;
  }
  if (c.kind === 'encoder') return [`A -> ${pin(c.pinA)}`, `B -> ${pin(c.pinB)}`, 'C (middle of the three) -> GND', 'no resistors needed (internal pull-ups)'];
  return ['end 1 -> GND', `end 2 -> ${v}`, `middle (wiper) -> ${c.mux ? `mux ${c.mux.id} channel C${c.mux.channel}` : adcPin(c.pin)}`];
}

export function bom(spec: DeviceSpec): Bom {
  const mcu = MCUS[spec.mcu];
  const { pin, adcPin, v } = pinNames(spec);
  const meters = spec.meters ?? [];

  const counts = new Map<string, number>();
  const bump = (id: string, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);
  spec.controls.forEach((c) => bump(c.part));
  meters.forEach((m) => bump(m.part, m.ledCount)); // priced per segment
  bump('mux-74hc4067', spec.muxes.length);
  if (spec.midiPort) bump(spec.midiPort.part);
  const covered = spec.controls.filter((c) => c.kind === 'button' && c.led).length + meters.reduce((s, m) => s + m.ledCount, 0);
  if (spec.leds && spec.leds.count > covered) bump('led-ws2812', spec.leds.count - covered); // stand-alone LEDs only

  const row = (part: string, partNumber: string, qty: number, notes: string, unitUsd: number, searchable = true): BomItem => ({
    part, partNumber, qty, notes, unitUsd, totalUsd: round2(unitUsd * qty), ...(searchable && unitUsd > 0 && { links: shop(partNumber) }),
  });
  const items: BomItem[] = [
    row(mcu.id, mcu.name, 1, 'Microcontroller board. ' + mcu.notes.join(' '), mcu.priceUsd),
    ...[...counts].map(([id, qty]) => {
      const p = PARTS[id];
      return row(id, p?.partNumber ?? id, qty, p?.wiring.join(' ') ?? 'Unknown part', p?.priceUsd ?? 0);
    }),
    ...(spec.leds
      ? [row('led-support', 'SN74AHCT125N + 330 ohm resistor + 1000 uF capacitor + 100 nF capacitors', 1, 'Level shifter for the 3.3 V data line, series resistor, bulk capacitor for the 5 V LEDs.', 2, false)]
      : []),
    ...(spec.midiPort
      ? [row('midi-support', '2 x 220 ohm resistor (+ H11L1 opto, 220 ohm, 1N4148, 10k pull-up if MIDI in is used)', 1, 'Current-loop resistors for the MIDI out; the opto parts are only for MIDI in.', 1, false)]
      : []),
    row('usb-cable', 'USB data cable (not charge-only)', 1, 'Micro-USB for Pico, micro-USB for Teensy 4.1.', 3, false),
    row('hookup-wire', '22 AWG solid wire + breadboard or perfboard', 1, 'Solder or breadboard everything before building an enclosure.', 6, false),
  ];

  const wiring: WiringRow[] = [];
  const muxRow = (m: DeviceSpec['muxes'][number]): WiringRow => ({
    control: m.id,
    connections: [
      `VCC -> ${v}`,
      'GND -> GND',
      m.enablePin !== undefined ? `EN -> ${pin(m.enablePin)} (active low: this mux shares its SIG pin with another)` : 'EN -> GND',
      `SIG -> ${m.signal === 'digital' ? pin(m.sigPin) + ' (digital, buttons)' : adcPin(m.sigPin)}`,
      ...m.selectPins.map((p, i) => `S${i} -> ${pin(p)}${spec.muxes.length > 1 ? ' (shared select bus)' : ''}`),
    ],
  });
  spec.muxes.forEach((m) => wiring.push(muxRow(m)));

  const byId = new Map<string, WiringRow>();
  for (const c of spec.controls) byId.set(c.id, { control: c.label ? `${c.id} (${c.label})` : c.id, connections: controlWiring(spec, c) });
  for (const m of meters)
    byId.set(m.id, {
      control: m.label ? `${m.id} (${m.label})` : m.id,
      connections: [`${m.ledCount} LEDs in the chain: #${m.ledStart}..#${m.ledStart + m.ledCount - 1}`, 'no extra wires: DIN/DOUT chain, 5 V and GND with the rest of the LEDs'],
    });
  const done = new Set<string>();
  for (const g of spec.groups ?? [])
    for (const id of g.members) {
      const r = byId.get(id);
      if (r && !done.has(id)) (done.add(id), wiring.push({ ...r, group: g.label }));
    }
  for (const [id, r] of byId) if (!done.has(id)) wiring.push(r);
  if (spec.midiPort) wiring.push({ control: 'MIDI port', connections: midiWiring(spec) });
  if (spec.leds)
    wiring.push({
      control: 'LED chain',
      connections: [`${pin(spec.leds.pin)} -> 74AHCT125 -> 330 ohm -> DIN of LED #0`, 'DOUT of each LED -> DIN of the next', 'VDD of every LED -> 5 V, GND -> GND', `${spec.leds.count} LEDs, brightness ${spec.leds.brightness}/255`],
    });

  return { items, wiring, totalUsd: round2(items.reduce((s, i) => s + i.totalUsd, 0)), };
}

function midiWiring(spec: DeviceSpec): string[] {
  const { pin } = pinNames(spec);
  const trs = spec.midiPort!.part === 'midi-trs-a';
  const [src, snk, shield] = trs ? ['Ring (DIN 4)', 'Tip (DIN 5)', 'Sleeve'] : ['DIN pin 4', 'DIN pin 5', 'DIN pin 2'];
  return [
    `3V3 -> 220 ohm -> ${src}`,
    `${pin(spec.midiPort!.txPin)} (UART TX) -> 220 ohm -> ${snk}`,
    `GND -> ${shield}`,
    spec.midiPort!.rxPin === undefined
      ? 'out only: no MIDI in'
      : `MIDI in: ${snk} -> 220 ohm -> opto LED (H11L1), ${src} -> LED other side, 1N4148 across it; opto output -> ${pin(spec.midiPort!.rxPin)} (UART RX) with a 10k pull-up to 3V3`,
  ];
}

/** Ordered, beginner-friendly assembly checklist. */
export function buildSteps(spec: DeviceSpec): BuildStep[] {
  const { pico, pin, adcPin } = pinNames(spec);
  const mcu = MCUS[spec.mcu];
  const { wiring } = bom(spec);
  const steps: BuildStep[] = [];
  const board = pico ? 'Pico' : 'Teensy';

  const cuts = cutoutsOf(spec);
  const rearCuts = cutoutsOf(spec, 'rear');
  const lay = spec.layout?.panel;
  steps.push({
    title: 'Make the panel',
    details: lay
      ? [
          `Panel: ${lay.width} x ${lay.depth} mm, ${lay.thickness} mm thick, ${lay.frontHeight === undefined ? `${lay.height} mm tall enclosure.` : `enclosure ${lay.height} mm tall at the back sloping down to ${lay.frontHeight} mm at the front.`}`,
          `3D print the top panel, walls, rear plate and bottom plate (export STL), or print the drill template at 100 % scale and drill/cut ${cuts.length} holes on top${rearCuts.length ? ` and ${rearCuts.length} in the rear wall (USB${spec.midiPort ? ', MIDI jack' : ''}; the template shows the rear as seen from outside)` : ''}.`,
          `Check the template against a ruler before cutting: the width on paper must read ${lay.width} mm.`,
        ]
      : ['No panel layout yet: run auto layout first, or breadboard everything loose and build the enclosure later.'],
  });
  steps.push({ title: 'Gather the parts', details: ['Order everything on the parts list. Check each part number: look-alikes have different pin layouts.'] });
  steps.push({
    title: `Mount the ${board}`,
    details: [
      `Fix the ${board} inside the enclosure with its USB connector at an edge you can reach. Leave ${mcu.board.height} mm of height for the board and wires.`,
      ...(pico ? ['Solder header pins (or the castellated edges) so wires can be attached; do not plug in USB yet.'] : ['Solder header pins if the Teensy has none; do not plug in USB yet.']),
    ],
  });
  steps.push({
    title: 'Power rails',
    details: [
      pico ? '3V3 rail: Pico pin 36 (3V3 OUT) to a wire/bus strip. Ground rail: Pico pin 38 or 33 (AGND for pots) to another.' : '3.3 V rail: a Teensy 3.3V pin to a bus strip. Ground rail: a GND pin to another.',
      ...(spec.leds ? [pico ? '5 V rail for the LEDs: Pico pin 40 (VBUS). LEDs get 5 V straight from USB, never from 3V3.' : '5 V rail for the LEDs: Teensy VIN (5 V from USB).'] : []),
      'Every part below connects to these rails. Double-check 3V3 never touches GND before plugging in.',
    ],
  });
  if (spec.midiPort)
    steps.push({
      title: 'MIDI port on the rear wall',
      details: [
        `Fit the ${PARTS[spec.midiPort.part]?.name ?? 'MIDI jack'} in its rear-wall hole.`,
        ...midiWiring(spec),
        'A MIDI cable now mirrors everything the USB port sends. Test it with a MIDI-to-USB interface or a synth.',
      ],
    });
  if (spec.muxes.length) {
    const sel = spec.muxes[0]!.selectPins;
    steps.push({
      title: 'Multiplexer boards and the shared select bus',
      details: [
        `Select bus: S0 -> ${pin(sel[0])}, S1 -> ${pin(sel[1])}, S2 -> ${pin(sel[2])}, S3 -> ${pin(sel[3])}. Wire every mux board's S0-S3 to the SAME four wires.`,
        ...spec.muxes.map((m) => `${m.id}: VCC -> 3V3, GND, EN -> ${m.enablePin !== undefined ? pin(m.enablePin) + ' (shared SIG pin: only one of these is ever enabled)' : 'GND'}, SIG -> ${m.signal === 'digital' ? pin(m.sigPin) : adcPin(m.sigPin)} (${m.signal === 'digital' ? 'buttons' : 'pots and faders'}).`),
      ],
    });
  }
  const groupRows = new Map<string, WiringRow[]>();
  for (const r of wiring) if (r.control !== 'LED chain' && !spec.muxes.some((m) => m.id === r.control)) groupRows.set(r.group ?? 'Other controls', [...(groupRows.get(r.group ?? 'Other controls') ?? []), r]);
  for (const [name, rows] of groupRows)
    steps.push({ title: `Wire ${name}`, details: rows.map((r) => `${r.control}: ${r.connections.join('; ')}`) });

  if (spec.leds) {
    const labelOf = (id: string) => spec.controls.find((c) => c.id === id)?.label ?? spec.meters?.find((m) => m.id === id)?.label ?? id;
    const chain = [
      ...spec.controls.flatMap((c) => (c.kind === 'button' && c.led ? [{ start: c.led.index, n: 1, id: c.id }] : [])),
      ...(spec.meters ?? []).map((m) => ({ start: m.ledStart, n: m.ledCount, id: m.id })),
    ].sort((a, b) => a.start - b.start);
    steps.push({
      title: 'LED chain (data line order)',
      details: [
        `Data: ${pin(spec.leds.pin)} -> 74AHCT125 level shifter (the LEDs run on 5 V, the ${board} outputs 3.3 V) -> 330 ohm -> DIN of LED #0.`,
        'Add a 1000 uF capacitor across 5 V / GND near LED #0 and a 100 nF capacitor near each strip.',
        'Run the data line through the LEDs in this order (DOUT of one -> DIN of the next):',
        ...chain.map((e) => `#${e.start}${e.n > 1 ? `-#${e.start + e.n - 1}` : ''}: ${(spec.groups?.find((g) => g.members.includes(e.id))?.label ?? '') + ' '}${labelOf(e.id)}${e.n > 1 ? ' (first LED = lowest level)' : ''}`),
      ],
    });
  }
  steps.push({
    title: pico ? 'Flash the firmware (.uf2)' : 'Upload the sketch',
    details: pico
      ? ['Hold the BOOTSEL button on the Pico while plugging in USB; a drive called RPI-RP2 appears.', 'Drag the downloaded .uf2 file onto it. The Pico reboots as a MIDI device by itself.']
      : ['Open the generated sketch in the Arduino IDE with Teensyduino installed, set Tools > USB Type > MIDI, and upload.'],
  });
  steps.push({
    title: 'Run the auto-test',
    details: ['Open the MIDI monitor in kont.rolla, connect to the device, and move every control once.', 'Each control should light up in the checklist; anything that does not points at its wiring row above.'],
  });
  return steps;
}
