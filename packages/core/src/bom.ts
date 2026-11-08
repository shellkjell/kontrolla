import { AUDIO_BOARDS, IO_MODULES, MCUS, PARTS, POWER_BOARD, adcChannel } from './catalog';
import type { BomLine, Maturity } from './catalog';
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
  /** 'experimental' = candidate or unproven part: check it before you spend money (the note says why). */
  maturity?: Maturity;
  /** What this item belongs to when it is not a surface part: 'Audio engine', 'Power board', 'Slot Ch 1: io-xlr', ... */
  section?: string;
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
      ? [row('midi-support', '33 ohm 0.5 W + 10 ohm resistor (+ H11L1 opto, 220 ohm, 1N4148, 10k pull-up if MIDI in is used)', 1, 'MIDI out current loop at 3.3 V (MIDI 1.0 electrical spec update CA-033); the opto parts are only for MIDI in.', 1, false)]
      : []),
    row('usb-cable', 'USB data cable (not charge-only)', 1, 'Micro-USB for Pico, micro-USB for Teensy 4.1.', 3, false),
    row('hookup-wire', '22 AWG solid wire + breadboard or perfboard', 1, 'Solder or breadboard everything before building an enclosure.', 6, false),
  ];

  items.push(...audioItems(spec));

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
  wiring.push(...audioWiring(spec));
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
    `3V3 -> 33 ohm 0.5 W -> ${src}`,
    `${pin(spec.midiPort!.txPin)} (UART TX) -> 10 ohm -> ${snk}`,
    `GND -> ${shield} (transmitter side only)`,
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
  if (spec.audio) steps.push(...audioSteps(spec));
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

const line = (l: BomLine, section: string, qtyMul = 1): BomItem => ({
  part: l.name,
  partNumber: l.partNumber,
  qty: l.qty * qtyMul,
  notes: l.notes ?? '',
  unitUsd: l.priceUsd,
  totalUsd: round2(l.priceUsd * l.qty * qtyMul),
  section,
  ...(l.maturity && { maturity: l.maturity }),
  ...(l.priceUsd > 0 && { links: shop(l.partNumber) }),
});

/** Audio hardware: the engine board, the power board, and one block per I/O slot and master output module. */
function audioItems(spec: DeviceSpec): BomItem[] {
  const a = spec.audio;
  if (!a) return [];
  const out: BomItem[] = [];
  const board = AUDIO_BOARDS[a.board];
  if (board) for (const l of board.bom) out.push(line({ ...l, ...(board.maturity === 'experimental' && !l.maturity && { maturity: 'experimental' as Maturity }) }, `Audio engine: ${board.name}`));
  for (const l of POWER_BOARD.bom) out.push(line(l, 'Power board'));
  const module = (id: string, where: string) => {
    const m = IO_MODULES[id];
    if (!m) return;
    const section = `${where}: ${m.id}`;
    const conns = new Map<string, number>();
    m.connectors.forEach((c) => conns.set(c.part, (conns.get(c.part) ?? 0) + 1));
    for (const [pid, qty] of conns) {
      const p = PARTS[pid];
      if (p) out.push({ part: pid, partNumber: p.partNumber, qty, notes: p.maturityNote ?? p.wiring.join(' '), unitUsd: p.priceUsd, totalUsd: round2(p.priceUsd * qty), section, ...(p.maturity && { maturity: p.maturity }), ...(p.priceUsd > 0 && { links: shop(p.partNumber) }) });
    }
    for (const l of m.frontEnd) out.push(line(l, section));
    out.push({ part: `${m.id}-pcb`, partNumber: 'module PCB (fab) + 2x8 IDC cable', qty: 1, notes: `ID resistor ${m.idOhm === null ? 'none (fixed jacks)' : m.idOhm + ' ohm'} from the ID pin to AGND. ${m.levelNote}`, unitUsd: m.pcbUsd, totalUsd: m.pcbUsd, section, maturity: m.maturity });
  };
  for (const s of spec.ioSlots ?? []) module(s.module, `Slot ${s.label ?? s.id}`);
  for (const m of a.master.outputs) module(m, IO_MODULES[m]?.mount === 'top' ? 'Phones (top panel)' : 'Master out');
  return out;
}

/** Wiring rows for the audio side: which codec ports each module takes, and its IDC header. */
function audioWiring(spec: DeviceSpec): WiringRow[] {
  const a = spec.audio;
  if (!a) return [];
  const rows: WiringRow[] = [];
  let port = 1;
  for (const ch of a.channels) {
    const slot = spec.ioSlots?.find((s) => s.id === ch.slot);
    const m = slot && IO_MODULES[slot.module];
    if (!slot || !m) continue;
    const ports = m.codecPorts === 1 ? `codec input ${port}` : `codec inputs ${port} + ${port + 1}`;
    rows.push({
      control: `Slot ${slot.label ?? slot.id}: ${m.id}`,
      group: ch.label,
      connections: [
        `2x8 IDC -> engine board input header: ${ports} (L+/L-${m.codecPorts > 1 ? '/R+/R-' : ''})`,
        `+12 V / -12 V / +5 V${m.phantom ? ' / +48 V (phantom)' : ''} from the power board, AGND, DGND`,
        m.selectable ? `SEL <- engine board${ch.bind.inputSelect ? ` (A/B button ${ch.bind.inputSelect})` : ''}` : 'SEL not used',
        `ID pin: ${m.idOhm === null ? 'open' : m.idOhm + ' ohm to AGND'}`,
      ],
    });
    port += m.codecPorts;
  }
  for (const id of a.master.outputs) {
    const m = IO_MODULES[id];
    if (m) rows.push({ control: `Master out: ${m.id}`, connections: [`2x8 IDC <- engine board ${m.bus} output pair (L+/L-/R+/R-)`, `+12 V / -12 V${m.selectable ? ' / +5 V' : ''}, AGND, DGND`, m.mount === 'top' ? 'jacks on the top panel' : 'plate in a rear slot'] });
  }
  return rows;
}

/** Audio build order: power first, then the engine, then ONE module with a test tone, then the rest. */
function audioSteps(spec: DeviceSpec): BuildStep[] {
  const a = spec.audio!;
  const board = AUDIO_BOARDS[a.board];
  const flag = (m: Maturity | undefined, why: string) => (m === 'experimental' ? ` [EXPERIMENTAL: ${why}]` : '');
  const steps: BuildStep[] = [];
  steps.push({
    title: 'Audio 1/5: power board (build and test it alone)',
    details: [
      `${POWER_BOARD.name}: ${POWER_BOARD.input} -> ${POWER_BOARD.rails.map((r) => `${r.rail} (up to ${r.maxMa} mA)`).join(', ')}.${flag(POWER_BOARD.maturity, POWER_BOARD.maturityNote)}`,
      'Nothing else is connected yet. Plug in a USB-C PD charger and measure: +5 V within 5 %, +12 V and -12 V within 5 %, +48 V only if you build phantom power (no load: it should be 46-50 V).',
      'Check that the PD sink really negotiates 15 V or 20 V at your charger. A board that resets in a loop is the wrong sink chip (CH224K boards have done that).',
      'Only when every rail reads right, connect the engine board. Always power down before you plug or unplug a module: slots are NOT hot-swappable.',
    ],
  });
  steps.push({
    title: 'Audio 2/5: engine board',
    details: [
      `${board?.name ?? a.board}.${flag(board?.maturity, board?.maturityNote ?? '')}`,
      ...(board ? board.pins.map((p) => `${p.signal} -> Teensy pin ${p.teensyPin}${p.note ? ` (${p.note})` : ''}`) : []),
      'Flash the engine sketch from the Build screen, then open the serial monitor: the codec should answer on I2C. With two codecs, check each one separately before you trust the pair.',
      'The surface and the engine talk over the MIDI port: TX of one to RX of the other, 3.3 V logic, common ground. Move a surface fader; the engine should log the CC.',
    ],
  });
  const first = a.channels[0];
  const firstSlot = first && spec.ioSlots?.find((s) => s.id === first.slot);
  const fm = firstSlot && IO_MODULES[firstSlot.module];
  steps.push({
    title: 'Audio 3/5: one input module, then the test tone',
    details: [
      fm ? `Build ${fm.name} first (slot ${firstSlot!.label ?? firstSlot!.id}). Connectors: ${fm.connectors.map((c) => `${c.label}: ${PARTS[c.part]?.partNumber ?? c.part}`).join('; ')}.${flag(fm.maturity, fm.maturityNote)}` : 'Build any one input module first.',
      'Solder the ID resistor, then check the ID pin voltage before the 2x8 IDC cable goes on (see docs/IO-SLOTS.md for the ladder).',
      'Feed a 1 kHz sine at -18 dBFS from a DAW or a tone generator at the jack level the module expects. The channel meter should light about 6 of 12 segments and the CS42448 input should read -18 dBFS.',
      'If you hear nothing: check SEL (A/B), the codec input pair order, and the +/-12 V rails at the module header.',
    ],
  });
  const rest = (spec.ioSlots ?? []).slice(1);
  steps.push({
    title: 'Audio 4/5: the remaining input modules',
    details: rest.length
      ? rest.map((s) => {
          const m = IO_MODULES[s.module];
          return `${s.label ?? s.id}: ${m?.name ?? s.module}${m?.phantom ? ' (has phantom power: switch it OFF until a mic is plugged in)' : ''}${flag(m?.maturity, 'candidate front end')}. Repeat the tone test.`;
        })
      : ['No more input modules.'],
  });
  steps.push({
    title: 'Audio 5/5: master and phones outputs',
    details: [
      ...a.master.outputs.map((id) => {
        const m = IO_MODULES[id];
        return m ? `${m.name} (${m.mount === 'top' ? 'jacks on the top panel' : 'rear slot'}): ${m.levelNote}${flag(m.maturity, 'driver ICs are candidates')}` : `Unknown output module ${id}`;
      }),
      'Start with the master fader and phones knob at minimum. Play the test tone through a channel and raise the master slowly, with the monitors or phones turned down first.',
      'The codec DAC full-scale level is not verified: measure the output with a meter before you connect anything expensive.',
    ],
  });
  return steps;
}
