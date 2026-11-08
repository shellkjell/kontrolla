import { MCUS, PARTS, adcChannel } from './catalog';
import type { DeviceSpec } from './types';

export interface BomItem {
  part: string; // catalog id
  partNumber: string;
  qty: number;
  notes: string;
}
export interface WiringRow {
  control: string; // control id, or mux id
  connections: string[];
}
export interface Bom {
  items: BomItem[];
  wiring: WiringRow[];
}

export function bom(spec: DeviceSpec): Bom {
  const mcu = MCUS[spec.mcu];
  const pico = spec.mcu === 'rp2040-pico';
  const pin = (p: number | undefined) => (p === undefined ? 'UNASSIGNED' : pico ? `GPIO${p}` : `pin ${p}`);
  const adcPin = (p: number | undefined) => (pico && p !== undefined ? `${pin(p)} (ADC${adcChannel(p)})` : pin(p));
  const v = pico ? '3V3(OUT)' : '3.3V';

  const counts = new Map<string, number>();
  const bump = (id: string, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);
  spec.controls.forEach((c) => bump(c.part));
  bump('mux-74hc4067', spec.muxes.length);

  const items: BomItem[] = [
    { part: mcu.id, partNumber: mcu.name, qty: 1, notes: 'Microcontroller board. ' + mcu.notes.join(' ') },
    ...[...counts].map(([id, qty]) => {
      const p = PARTS[id];
      return { part: id, partNumber: p?.partNumber ?? id, qty, notes: p?.wiring.join(' ') ?? 'Unknown part' };
    }),
    { part: 'usb-cable', partNumber: 'USB data cable (not charge-only)', qty: 1, notes: 'Micro-USB for Pico, micro-USB for Teensy 4.1.' },
    { part: 'hookup-wire', partNumber: '22 AWG solid wire + breadboard or perfboard', qty: 1, notes: 'Solder or breadboard everything before building an enclosure.' },
  ];

  const wiring: WiringRow[] = [];
  for (const m of spec.muxes)
    wiring.push({
      control: m.id,
      connections: [
        `VCC -> ${v}`,
        'GND -> GND',
        'EN -> GND',
        `SIG -> ${adcPin(m.sigPin)}`,
        ...m.selectPins.map((p, i) => `S${i} -> ${pin(p)}`),
      ],
    });
  for (const c of spec.controls) {
    const name = c.label ? `${c.id} (${c.label})` : c.id;
    let conn: string[];
    if (c.kind === 'button') conn = [`one leg -> ${pin(c.pin)}`, 'other leg -> GND', 'no resistor needed (internal pull-up)'];
    else if (c.kind === 'encoder')
      conn = [`A -> ${pin(c.pinA)}`, `B -> ${pin(c.pinB)}`, 'C (middle of the three) -> GND', 'no resistors needed (internal pull-ups)'];
    else {
      const wiper = c.mux ? `mux ${c.mux.id} channel C${c.mux.channel}` : adcPin(c.pin);
      conn = [`end 1 -> GND`, `end 2 -> ${v}`, `middle (wiper) -> ${wiper}`];
    }
    wiring.push({ control: name, connections: conn });
  }
  return { items, wiring };
}
