import { expect, test } from 'bun:test';
import type { DeviceSpec } from '../src';
import { AUDIO_BOARDS, EXAMPLES, IO_MODULES, PARTS, allocatePins, autoLayout, bom, buildSteps, cutoutsOf, duplicateGroup, ensureLayout, groupOf, nextFreeMidi, validate, validateAudio, validateLayout } from '../src';

const errors = (s: Parameters<typeof validate>[0]) => validate(s).filter((i) => i.severity === 'error');

test('mixer-6ch fits a Pico: 3 analog + digital muxes on one select bus, no errors', () => {
  const s = allocatePins(EXAMPLES['mixer-6ch']!);
  expect(errors(s)).toEqual([]);
  const analog = s.muxes.filter((m) => m.signal === 'analog');
  expect(analog.length).toBe(4);
  // muxes 1 and 4 share an ADC pin and are told apart by EN
  const shared = analog.filter((m) => analog.filter((o) => o.sigPin === m.sigPin).length > 1);
  expect(shared.length).toBe(2);
  expect(shared.every((m) => m.enablePin !== undefined)).toBe(true);
  expect(new Set(shared.map((m) => m.enablePin)).size).toBe(2);
  expect(s.muxes.some((m) => m.signal === 'digital')).toBe(true);
  expect(new Set(s.muxes.map((m) => m.selectPins.join())).size).toBe(1);
  expect(s.leds?.pin).toBeDefined();
  expect(s.leds?.count).toBe(121);
  const tx = s.midiPort!.txPin!;
  expect([[0, 1], [12, 13], [16, 17], [4, 5], [8, 9]].some(([a, b]) => a === tx && b === s.midiPort!.rxPin)).toBe(true);
  expect(allocatePins(EXAMPLES['mixer-6ch']!)).toEqual(s);
  expect(bom(s).totalUsd).toBeGreaterThan(50);
  expect(buildSteps(s).map((x) => x.title)).toContain('LED chain (data line order)');
});

test('duplicateGroup: ids, labels, MIDI offset, LEDs, placement', () => {
  const m = EXAMPLES['mixer-6ch']!;
  const g = m.groups!.find((x) => x.id === 'ch1')!;
  expect(m.groups!.map((x) => x.label).slice(0, 6)).toEqual(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 6']);
  const gain2 = m.controls.find((c) => c.id === 'ch2-gain')!;
  expect(gain2.midi.type === 'cc' && gain2.midi.cc).toBe(12 + 10);
  const mute3 = m.controls.find((c) => c.id === 'ch3-mute')!;
  expect(mute3.midi.type === 'note' && mute3.midi.note).toBe(26 + 8);
  expect(groupOf(m, 'ch4-solo')?.id).toBe('ch4');
  const leds = [...m.controls.flatMap((c) => (c.kind === 'button' && c.led ? [c.led.index] : [])), ...m.meters!.flatMap((x) => Array.from({ length: x.ledCount }, (_, i) => x.ledStart + i))];
  expect(new Set(leds).size).toBe(leds.length);
  expect(g.members.length).toBe(14);
  expect(m.layout!.placements['ch2-gain']!.x).toBeGreaterThan(m.layout!.placements['ch1-gain']!.x);
});

test('duplicateGroup moves to the next channel when CC numbers run out', () => {
  let s = EXAMPLES['mixer-6ch']!;
  s = duplicateGroup(s, 'ch6', 9); // ch15's block would end past CC 127
  const last = s.controls.find((c) => c.id === 'ch15-gain')!;
  expect(last.midi.channel).toBeGreaterThan(1);
});

test('nextFreeMidi', () => {
  const s = EXAMPLES.starter!;
  expect(nextFreeMidi(s, 'cc', 1)?.number).toBe(1);
  expect(nextFreeMidi(s, 'note', 1)?.number).toBe(0);
});

test('autoLayout has no overlaps and no errors for all presets', () => {
  for (const [name, spec] of Object.entries(EXAMPLES)) {
    expect(spec.layout, name).toBeDefined();
    const bad = validateLayout(spec).filter((i) => i.severity !== 'info');
    expect(bad, name).toEqual([]);
    expect(autoLayout(spec)).toEqual(spec.layout!);
  }
});

test('validateLayout catches a seeded overlap, an edge cut and a missing placement', () => {
  const s = structuredClone(EXAMPLES.starter!);
  s.layout!.placements.pot2 = { ...s.layout!.placements.pot1! };
  s.layout!.placements.pot3 = { x: 1, y: 1 };
  delete s.layout!.placements.btn1;
  const msgs = validateLayout(s);
  expect(msgs.some((i) => i.severity === 'error' && i.message.includes('overlap'))).toBe(true);
  expect(msgs.some((i) => i.severity === 'error' && i.message.includes('edge'))).toBe(true);
  expect(msgs.some((i) => i.severity === 'info' && i.controlId === 'btn1')).toBe(true);
  expect(ensureLayout(s).layout!.placements.btn1).toBeDefined();
});

test('finger clearance warning', () => {
  const s = structuredClone(EXAMPLES.starter!);
  const a = s.layout!.placements.pot1!;
  s.layout!.placements.pot2 = { x: a.x + 16, y: a.y };
  expect(validateLayout(s).some((i) => i.severity === 'warning' && i.message.includes('hard to turn'))).toBe(true);
});

test('duplicateGroup gives unique ids when member ids are consecutive', async () => {
  const { createGroup } = await import('../src');
  const pot = (id: string) => ({ id, kind: 'pot' as const, part: 'pot-b10k', midi: { type: 'cc' as const, channel: 1, cc: id === 'pot1' ? 1 : 2, min: 0, max: 127 }, deadband: 12, smoothing: 0 });
  let spec: DeviceSpec = { ...EXAMPLES.starter!, controls: [pot('pot1'), pot('pot2')], muxes: [], groups: [], layout: undefined, meters: [], leds: undefined };
  spec = createGroup(spec, 'Ch 1', ['pot1', 'pot2'], { kind: 'strip' });
  const ids = duplicateGroup(spec, spec.groups![0]!.id, 2).controls.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('labels: faders are Fader n, no preset mixes knobs and faders up', () => {
  const tm = EXAMPLES['teensy-mixer']!;
  expect(tm.controls.filter((c) => c.kind === 'fader').map((c) => c.label)).toEqual(['Fader 1', 'Fader 2', 'Fader 3', 'Fader 4', 'Fader 5', 'Fader 6']);
  for (const spec of Object.values(EXAMPLES))
    for (const c of spec.controls) {
      if (c.kind === 'fader') expect(c.label ?? '', c.id).not.toMatch(/^Knob/);
      if (c.kind === 'pot') expect(c.label ?? '', c.id).not.toMatch(/^Fader/);
      expect(c.label, c.id).toBeTruthy();
    }
});

test('mixer-6ch: 4-band EQ, filter, pan, meters beside the faders, numbered strips', () => {
  const m = EXAMPLES['mixer-6ch']!;
  for (const n of [1, 6])
    for (const k of ['gain', 'hi', 'himid', 'lomid', 'lo', 'filter', 'fx', 'pan', 'input', 'cue', 'mute', 'solo', 'fader', 'meter'])
      expect(m.controls.some((c) => c.id === `ch${n}-${k}`) || m.meters!.some((x) => x.id === `ch${n}-${k}`), `ch${n}-${k}`).toBe(true);
  for (const id of ['master-fader', 'booth', 'phones', 'cue-mix', 'fx-return', 'fx-select', 'tap']) expect(m.controls.some((c) => c.id === id), id).toBe(true);
  expect(m.meters!.filter((x) => x.ledCount === 12).length).toBe(8); // 6 strips + master L/R
  expect(m.controls.find((c) => c.id === 'ch1-hi')!.part).toBe('pot-b10k-detent');
  const p = m.layout!.placements;
  for (const n of [1, 4]) {
    expect(p[`ch${n}-meter`]!.y).toBe(p[`ch${n}-fader`]!.y);
    expect(p[`ch${n}-meter`]!.x).toBeLessThan(p[`ch${n}-fader`]!.x);
  }
  const nums = m.layout!.annotations.filter((a) => a.id.startsWith('num-'));
  expect(nums.map((a) => (a.kind === 'text' ? a.text : ''))).toEqual(['1', '2', '3', '4', '5', '6']);
  expect(m.groups!.filter((g) => g.kind === 'strip').map((g) => g.label)).toEqual(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4', 'Ch 5', 'Ch 6']);
});

test('mixer-6ch: wedge, rear face, USB and MIDI jack placed on the rear wall', () => {
  const lay = EXAMPLES['mixer-6ch']!.layout!;
  expect(lay.panel.frontHeight).toBeLessThan(lay.panel.height);
  expect(lay.placements.usb?.face).toBe('rear');
  expect(lay.placements['midi-port']?.face).toBe('rear');
  expect(validateLayout(EXAMPLES['mixer-6ch']!).filter((i) => i.severity !== 'info')).toEqual([]);
});

test('rear cutouts: outside the wall is an error; adding a MIDI port places it on the rear', () => {
  const s = structuredClone(EXAMPLES.starter!);
  s.layout!.placements.usb!.y = 500;
  expect(validateLayout(s).some((i) => i.severity === 'error' && i.controlId === 'usb')).toBe(true);
  const t = structuredClone(EXAMPLES.starter!);
  t.midiPort = { part: 'midi-din5' };
  const e = ensureLayout(t);
  expect(e.layout!.placements['midi-port']?.face).toBe('rear');
  expect(validateLayout(e).filter((i) => i.severity !== 'info')).toEqual([]);
});

test('allocatePins: MIDI port pair avoids manual pins; shared ADC pins get distinct EN pins', () => {
  const s = structuredClone(EXAMPLES.starter!);
  s.midiPort = { part: 'midi-trs-a' };
  const btn = s.controls.find((c) => c.kind === 'button')!;
  if (btn.kind === 'button') btn.pin = 0; // takes UART0's default pair
  const a = allocatePins(s);
  expect([a.midiPort!.txPin, a.midiPort!.rxPin]).toEqual([12, 13]);
  expect(errors(a)).toEqual([]);
});

test('duplicateGroup copies the strip number', () => {
  const s = duplicateGroup(EXAMPLES['mixer-6ch']!, 'ch6', 1);
  const n = s.layout!.annotations.find((a) => a.id === 'num-ch7');
  expect(n?.kind === 'text' && n.text).toBe('7');
});

test('bom: MIDI jack parts and build steps mention the rear wall', () => {
  const s = allocatePins(EXAMPLES['mixer-6ch']!);
  expect(bom(s).items.some((i) => i.part === 'midi-trs-a')).toBe(true);
  expect(buildSteps(s).some((x) => x.title.includes('MIDI'))).toBe(true);
});

// ---- audio I/O ----

test('catalog: every I/O module is self-consistent and fits the slot plate', () => {
  const ids = new Set<number | null>();
  for (const m of Object.values(IO_MODULES)) {
    expect(m.maturityNote, m.id).toBeTruthy();
    expect(m.connectors.length, m.id).toBeGreaterThan(0);
    if (m.direction === 'out') expect(m.bus, m.id).toBeDefined();
    if (m.direction === 'in') expect(m.inputs?.length, m.id).toBe(m.selectable ? 2 : 1);
    if (m.mount === 'top') {
      for (const c of m.connectors) expect(PARTS[c.part]?.footprint?.face, c.part).toBeUndefined(); // top-panel parts
      continue;
    }
    expect(ids.has(m.idOhm), `${m.id} id resistor is unique`).toBe(false);
    ids.add(m.idOhm);
    // connectors stay inside the 32 x 66 opening and do not overlap each other
    for (const c of m.connectors) {
      const fp = PARTS[c.part]?.footprint;
      expect(fp?.face, c.part).toBe('rear');
      const w = fp!.cap.shape === 'circle' ? fp!.cap.d : fp!.cap.w;
      const h = fp!.cap.shape === 'circle' ? fp!.cap.d : fp!.cap.h;
      expect(Math.abs(c.dx) + w / 2, `${m.id} ${c.label} width`).toBeLessThanOrEqual(16 + 1e-9);
      expect(Math.abs(c.dy) + h / 2, `${m.id} ${c.label} height`).toBeLessThanOrEqual(33 + 1e-9);
    }
    for (const a of m.connectors) for (const b of m.connectors) {
      if (a === b) continue;
      const sz = (c: typeof a) => { const cap = PARTS[c.part]!.footprint!.cap; return cap.shape === 'circle' ? [cap.d, cap.d] : [cap.w, cap.h]; };
      const [aw, ah] = sz(a) as [number, number];
      const [bw, bh] = sz(b) as [number, number];
      expect(Math.abs(a.dx - b.dx) >= (aw + bw) / 2 - 1e-9 || Math.abs(a.dy - b.dy) >= (ah + bh) / 2 - 1e-9, `${m.id}: ${a.label} vs ${b.label}`).toBe(true);
    }
  }
  // ID ladder with a 10 k pull-up: neighbours at least 150 ADC counts apart
  const counts = [...new Set([...ids].map((r) => (r === null ? 4095 : Math.round((r / (r + 10000)) * 4095))))].sort((a, b) => a - b);
  for (let i = 1; i < counts.length; i++) expect(counts[i]! - counts[i - 1]!).toBeGreaterThan(150);
});

test('catalog: audio boards, maturity flags', () => {
  expect(AUDIO_BOARDS['teensy41-cs42448']).toMatchObject({ maturity: 'proven', inputs: 6, outputs: 8, stereoChannels: 3 });
  expect(AUDIO_BOARDS['teensy41-cs42448x2']).toMatchObject({ maturity: 'experimental', inputs: 12, outputs: 16, stereoChannels: 6 });
  expect(AUDIO_BOARDS['teensy41-cs42448x2']!.maturityNote).toContain('UNPROVEN');
  expect(PARTS['midi-trs-a']!.wiring.join(' ')).toContain('33 ohm');
  expect(PARTS['midi-trs-a']!.wiring.join(' ')).toContain('10 ohm');
});

test('mixer presets: audio bindings point at real controls and meters; no validation errors', () => {
  for (const name of ['mixer-6ch', 'mixer-3ch']) {
    const spec = allocatePins(EXAMPLES[name]!);
    expect(validateAudio(spec).filter((i) => i.severity === 'error'), name).toEqual([]);
    expect(validate(spec).filter((i) => i.severity === 'error'), name).toEqual([]);
    expect(validateLayout(spec).filter((i) => i.severity !== 'info'), name).toEqual([]);
    const ids = new Set([...spec.controls.map((c) => c.id), ...spec.meters!.map((m) => m.id)]);
    for (const ch of spec.audio!.channels) {
      expect(Object.keys(ch.bind).sort(), ch.id).toEqual(['cue', 'eqHi', 'eqHiMid', 'eqLo', 'eqLoMid', 'fader', 'filter', 'fxSend', 'gain', 'inputSelect', 'mute', 'pan', 'solo']);
      for (const id of Object.values(ch.bind)) expect(ids.has(id!), id).toBe(true);
      expect(ids.has(ch.meter!), ch.meter).toBe(true);
      expect(spec.ioSlots!.some((s) => s.id === ch.slot)).toBe(true);
    }
    expect(Object.keys(spec.audio!.master.bind).sort()).toEqual(['booth', 'cueMix', 'fxReturn', 'master', 'phones']);
    expect(spec.audio!.master.meters).toEqual({ left: 'master-meter-l', right: 'master-meter-r' });
  }
});

test('mixer-6ch is the unproven 2-codec board with mixed input modules, mixer-3ch the proven one', () => {
  const six = EXAMPLES['mixer-6ch']!;
  expect(six.audio!.board).toBe('teensy41-cs42448x2');
  expect(six.ioSlots!.map((s) => s.module)).toEqual(['io-trs-rca-combo', 'io-trs-rca-combo', 'io-trs-rca-combo', 'io-trs-rca-combo', 'io-xlr', 'io-dual-xlr']);
  expect(validateAudio(six).some((i) => i.severity === 'warning' && i.message.includes('UNPROVEN'))).toBe(true);
  const three = EXAMPLES['mixer-3ch']!;
  expect(three.name).toBe('Portable Mixer 3 — proven');
  expect(three.audio!.board).toBe('teensy41-cs42448');
  expect(three.audio!.channels.length).toBe(3);
  expect(validateAudio(three).some((i) => i.severity === 'warning')).toBe(false);
  expect(three.groups!.filter((g) => g.kind === 'strip').length).toBe(3);
});

test('validateAudio catches bad bindings, wrong direction and too many inputs', () => {
  const s = structuredClone(EXAMPLES['mixer-3ch']!);
  s.audio!.channels[0]!.bind.gain = 'nope';
  s.audio!.channels[1]!.meter = 'nope-meter';
  s.ioSlots![2]!.module = 'out-booth';
  const errs = validateAudio(s).filter((i) => i.severity === 'error').map((i) => i.message);
  expect(errs.some((m) => m.includes('"nope"'))).toBe(true);
  expect(errs.some((m) => m.includes('nope-meter'))).toBe(true);
  expect(errs.some((m) => m.includes('output module'))).toBe(true);
  const big = structuredClone(EXAMPLES['mixer-3ch']!);
  big.ioSlots!.forEach((x) => (x.module = 'io-dual-xlr'));
  big.audio!.board = 'teensy41-cs42448';
  big.audio!.channels.push({ id: 'x', label: 'X', slot: 'x-io', stereo: true, bind: {} });
  big.ioSlots!.push({ id: 'x-io', module: 'io-rca' });
  expect(validateAudio(big).some((i) => i.severity === 'error' && i.message.includes('codec inputs'))).toBe(true);
});

test('rear layout: one slot per channel behind its strip, master outputs after, all fit the wall', () => {
  const six = allocatePins(EXAMPLES['mixer-6ch']!);
  const lay = six.layout!;
  const gainX = (n: number) => lay.placements[`ch${n}-gain`]!.x;
  for (let n = 1; n <= 6; n++) {
    const slot = lay.placements[`ch${n}-io`]!;
    expect(slot.face).toBe('rear');
    expect(Math.abs(slot.x - gainX(n))).toBeLessThan(1);
  }
  const masters = ['out-trs-rca-combo', 'out-xlr-pair', 'out-booth'].map((m) => lay.placements[`master:${m}`]!);
  expect(masters.every((p) => p.face === 'rear' && p.x > lay.placements['ch6-io']!.x)).toBe(true);
  // the rear wall is tall enough for the 80 mm slot row plus the service row, the front stays low
  expect(lay.panel.height - 2 * lay.panel.thickness).toBeGreaterThanOrEqual(84);
  expect(lay.panel.frontHeight!).toBeLessThanOrEqual(24);
  for (const c of cutoutsOf(six, 'rear')) {
    const hw = (c.d ?? c.w!) / 2;
    expect(c.x - hw).toBeGreaterThanOrEqual(3);
    expect(c.x + hw).toBeLessThanOrEqual(lay.panel.width - 3);
    expect(c.y - (c.d ?? c.h!) / 2).toBeGreaterThanOrEqual(lay.panel.thickness + 2);
    expect(c.y + (c.d ?? c.h!) / 2).toBeLessThanOrEqual(lay.panel.height - lay.panel.thickness - 2);
  }
  // a rear that is too short for a slot is an error
  const short = structuredClone(six);
  short.layout!.panel.height = 40;
  expect(validateLayout(short).some((i) => i.severity === 'error')).toBe(true);
});

test('bom: audio board, power board and modules with maturity flags; build steps put power first', () => {
  const six = allocatePins(EXAMPLES['mixer-6ch']!);
  const b = bom(six);
  expect(b.items.some((i) => i.section?.startsWith('Audio engine') && i.maturity === 'experimental')).toBe(true);
  expect(b.items.some((i) => i.section === 'Power board')).toBe(true);
  expect(b.items.some((i) => i.section?.includes('io-dual-xlr') && i.partNumber.includes('NC3FD-L-1'))).toBe(true);
  expect(b.items.some((i) => i.section?.startsWith('Master out'))).toBe(true);
  expect(b.wiring.some((r) => r.control.includes('io-xlr'))).toBe(true);
  expect(b.wiring.find((r) => r.control === 'MIDI port')!.connections.join(' ')).toMatch(/33 ohm.*\n?.*10 ohm|33 ohm/);
  const titles = buildSteps(six).map((s) => s.title);
  const i = titles.findIndex((t) => t.startsWith('Audio 1/5'));
  expect(i).toBeGreaterThan(-1);
  expect(titles.findIndex((t) => t.startsWith('Audio 2/5'))).toBeGreaterThan(i);
  expect(titles.findIndex((t) => t.startsWith('Audio 3/5'))).toBeGreaterThan(i + 1);
  expect(buildSteps(six).find((t) => t.title.startsWith('Audio 3/5'))!.details.join(' ')).toContain('1 kHz');
  expect(b.totalUsd).toBeGreaterThan(bom(allocatePins(EXAMPLES['mixer-3ch']!)).totalUsd);
});
