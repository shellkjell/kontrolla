// Audio bindings: I/O slots and the engine's links to the surface. The surface drives the engine over spec.midiPort.
import { AUDIO_BOARDS, IO_MODULES } from './catalog';
import type { AudioChannel, ChannelParam, DeviceSpec, MasterParam } from './types';
import type { Issue } from './validate';

/** Strip member id suffix (after "<group id>-") -> engine parameter. This is the naming convention the presets use. */
export const STRIP_PARAMS: Record<string, ChannelParam> = {
  gain: 'gain', hi: 'eqHi', himid: 'eqHiMid', lomid: 'eqLoMid', lo: 'eqLo', filter: 'filter', fx: 'fxSend', pan: 'pan',
  fader: 'fader', mute: 'mute', solo: 'solo', cue: 'cue', input: 'inputSelect',
};
/** Master control ids the presets use -> engine parameter. */
export const MASTER_PARAMS: Record<string, MasterParam> = {
  'master-fader': 'master', booth: 'booth', phones: 'phones', 'cue-mix': 'cueMix', 'fx-return': 'fxReturn',
};
const CONTINUOUS = new Set<ChannelParam | MasterParam>(['gain', 'eqHi', 'eqHiMid', 'eqLoMid', 'eqLo', 'filter', 'fxSend', 'pan', 'fader', 'master', 'booth', 'phones', 'cueMix', 'fxReturn']);

export interface BindOptions {
  board: string; // AUDIO_BOARDS id
  modules: string[]; // input module per strip, in strip order (the last one repeats if there are more strips)
  masterOutputs?: string[]; // IO_MODULES ids with direction 'out'
}

/** Give every strip group an I/O slot ("<group id>-io") and an engine channel bound to its controls, and bind the master section. */
export function bindStripAudio(input: DeviceSpec, opts: BindOptions): DeviceSpec {
  const spec = structuredClone(input);
  const strips = (spec.groups ?? []).filter((g) => g.kind === 'strip');
  const ids = new Set([...spec.controls.map((c) => c.id), ...(spec.meters ?? []).map((m) => m.id)]);
  spec.ioSlots = strips.map((g, i) => ({ id: `${g.id}-io`, label: g.label, module: opts.modules[Math.min(i, opts.modules.length - 1)]! }));
  const channels: AudioChannel[] = strips.map((g, i) => {
    const bind: AudioChannel['bind'] = {};
    let meter: string | undefined;
    for (const id of g.members) {
      const key = id.startsWith(`${g.id}-`) ? id.slice(g.id.length + 1) : '';
      if (STRIP_PARAMS[key]) bind[STRIP_PARAMS[key]!] = id;
      if (key === 'meter') meter = id;
    }
    const slot = spec.ioSlots![i]!;
    return { id: g.id, label: g.label, slot: slot.id, stereo: true, bind, ...(meter && { meter }) }; // stereo even for a mono module: it is dual-mono
  });
  const masterBind: Partial<Record<MasterParam, string>> = {};
  for (const [id, param] of Object.entries(MASTER_PARAMS)) if (ids.has(id)) masterBind[param] = id;
  const l = ids.has('master-meter-l') ? 'master-meter-l' : undefined;
  const r = ids.has('master-meter-r') ? 'master-meter-r' : undefined;
  spec.audio = {
    board: opts.board,
    channels,
    master: { bind: masterBind, ...((l || r) && { meters: { ...(l && { left: l }), ...(r && { right: r }) } }), outputs: opts.masterOutputs ?? [] },
  };
  return spec;
}

/** Checks of spec.audio / spec.ioSlots: capacity of the engine board, modules and bindings that point at things that exist. */
export function validateAudio(spec: DeviceSpec): Issue[] {
  const out: Issue[] = [];
  const add = (severity: Issue['severity'], message: string, controlId?: string, fix?: string) =>
    out.push({ severity, message, ...(controlId !== undefined && { controlId }), ...(fix !== undefined && { fix }) });
  const a = spec.audio;
  if (!a) return (spec.ioSlots?.length ?? 0) > 0 ? [{ severity: 'info', message: 'I/O slots are defined but there is no audio engine to read them' }] : [];

  const board = AUDIO_BOARDS[a.board];
  if (!board) add('error', `Unknown audio board "${a.board}"`, undefined, `Use one of ${Object.keys(AUDIO_BOARDS).join(', ')}`);
  else if (board.maturity === 'experimental') add('warning', `${board.name} is UNPROVEN: ${board.maturityNote}`, undefined, 'Breadboard it first, or use teensy41-cs42448 (3 channels)');

  const slotIds = new Set<string>();
  for (const s of spec.ioSlots ?? []) {
    if (slotIds.has(s.id)) add('error', `Duplicate I/O slot id "${s.id}"`);
    slotIds.add(s.id);
    const m = IO_MODULES[s.module];
    if (!m) add('error', `Slot ${s.id} holds unknown module "${s.module}"`, undefined, 'Pick a module from the catalog');
    else if (m.mount !== 'slot') add('error', `Module ${m.id} goes on the top panel, not in a rear slot (${s.id})`);
  }

  const controls = new Map(spec.controls.map((c) => [c.id, c]));
  const meters = new Set((spec.meters ?? []).map((m) => m.id));
  const bindOk = (param: ChannelParam | MasterParam, id: string | undefined, who: string) => {
    if (!id) return;
    const c = controls.get(id);
    if (!c) return add('error', `${who}: ${param} is bound to "${id}", which is not a control`, id, 'Bind it to an existing control id');
    const analog = c.kind === 'pot' || c.kind === 'fader';
    if (CONTINUOUS.has(param) && !analog && c.kind !== 'encoder') add('warning', `${who}: ${param} is bound to the ${c.kind} ${id}; the engine will only see on/off`, id);
    if (!CONTINUOUS.has(param) && c.kind !== 'button') add('warning', `${who}: ${param} is a switch but ${id} is a ${c.kind}`, id, 'Bind it to a button');
  };

  let inputs = 0;
  const used = new Set<string>();
  for (const ch of a.channels) {
    const slot = spec.ioSlots?.find((s) => s.id === ch.slot);
    const m = slot && IO_MODULES[slot.module];
    if (!slot) add('error', `Channel ${ch.label} reads slot "${ch.slot}", which does not exist`, undefined, 'Add the slot or fix the id');
    else if (m && m.direction !== 'in') add('error', `Channel ${ch.label} reads slot ${slot.id}, which holds an output module (${m.id})`);
    if (slot && used.has(slot.id)) add('error', `Slot ${slot.id} feeds more than one channel`);
    if (slot) used.add(slot.id);
    if (m) inputs += m.codecPorts;
    if (m?.signal === 'mono' && ch.stereo) add('info', `${ch.label}: ${m.name} is mono; the engine feeds it to both sides`);
    for (const [param, id] of Object.entries(ch.bind)) bindOk(param as ChannelParam, id, ch.label);
    if (ch.meter && !meters.has(ch.meter)) add('error', `${ch.label}: meter "${ch.meter}" does not exist`, ch.meter);
    if (ch.bind.inputSelect && m && !m.selectable) add('info', `${ch.label}: the A/B button does nothing with ${m.name} (one input set)`, ch.bind.inputSelect);
  }
  for (const s of spec.ioSlots ?? []) if (!a.channels.some((c) => c.slot === s.id)) add('info', `Slot ${s.id} has no channel; it stays a blank plate`);
  if (board && inputs > board.inputs) add('error', `The modules use ${inputs} codec inputs but ${board.name} has ${board.inputs}`, undefined, 'Use the 2-codec board (unproven) or fewer channels');

  for (const [param, id] of Object.entries(a.master.bind)) bindOk(param as MasterParam, id, 'Master');
  for (const [side, id] of Object.entries(a.master.meters ?? {})) if (id && !meters.has(id)) add('error', `Master ${side} meter "${id}" does not exist`, id);
  const buses = new Set<string>();
  for (const id of a.master.outputs) {
    const m = IO_MODULES[id];
    if (!m) add('error', `Unknown master output module "${id}"`);
    else if (m.direction !== 'out') add('error', `Master output ${id} is an input module`);
    else if (m.bus) buses.add(m.bus);
  }
  if (board && buses.size * 2 > board.outputs) add('error', `${buses.size} output buses need ${buses.size * 2} codec outputs but ${board.name} has ${board.outputs}`);
  const exp = [...new Set([...(spec.ioSlots ?? []).map((s) => s.module), ...a.master.outputs])].filter((id) => IO_MODULES[id]?.maturity === 'experimental');
  if (exp.length) add('info', `Experimental modules (candidate front ends, nothing built): ${exp.join(', ')}`);
  return out;
}

/** The module sitting in a rear slot: an I/O slot id, or "master:<module id>" for the fixed master outputs. */
export function moduleOfSlot(spec: DeviceSpec, id: string): string | undefined {
  return id.startsWith('master:') ? id.slice('master:'.length) : spec.ioSlots?.find((s) => s.id === id)?.module;
}
