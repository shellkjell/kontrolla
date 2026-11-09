// Pure-TS mixer engine. Semantics: docs/AUDIO.md (this file is the browser reference; the Teensy sketch must match it).
// No WebAudio dependency: runs in bun tests, in an AudioWorklet, or offline.
import { AUDIO_BOARDS, type ChannelParam, type Control, type DeviceSpec, type MasterParam } from '@kontrolla/core';
import {
  BLOCK, Biquad, CLIP_DB, EQ_BANDS, FILTER_Q, IDENTITY, SAMPLE_RATE, cueMixGains, dbToLin, eqDb, faderDb, filterMode, gainDb, highpass,
  levelDb, linToDb, lowpass, meterCc, panBalance, panMono,
} from './curves';
import { Reverb } from './fx';
import { channelModule, trimDbFor } from './levels';

export type Stereo = [Float32Array, Float32Array];
export interface EngineOutputs { master: Stereo; booth: Stereo; phones: Stereo }

export interface EngineOptions {
  sampleRate?: number; // default 44100
  /**
   * Per channel analogue gain jack→ADC in dB, overriding the catalog module's pad/preamp for BOTH inputs (A and B). Default: derived from
   * the channel's IO_MODULES entry, per input; inputSelect switches it. Inputs are jack volts (1.0 = 1 Vrms), see levels.ts.
   */
  trimDb?: (number | undefined)[];
  /** Mic preamp gain per channel id (module default otherwise); must lie in the module's gainRangeDb. */
  preampDb?: Record<string, number>;
  meterHz?: number; // meter CC rate, default 30
}

export interface StageStat { peakDb: number; clip: boolean }
export interface ChannelStats {
  id: string;
  active: boolean; // false = beyond the board's channel capacity: not processed, silent
  input: 'A' | 'B'; // input of the module currently feeding the channel
  trimDb: number; // analogue gain jack→ADC of that input
  adc: StageStat; // after trim, before the ADC clamp
  pre: StageStat; // after gain/EQ/filter, before the fader (the 16-bit headroom point on the Teensy)
  post: StageStat; // after the fader (the metered point)
  clip: boolean; // adc || pre || post
  meterCc: number;
  audible: boolean; // not muted and (no solo active or this one soloed)
}
export interface EngineStats {
  channels: ChannelStats[];
  master: { left: StageStat; right: StageStat; meterCc: [number, number] };
  anySolo: boolean;
  /** Ids of channels beyond the board's capacity (AUDIO_BOARDS[board].stereoChannels): not processed. */
  overCapacity: string[];
  cpu: number; // process() wall time / block duration, smoothed; 0 where no clock is available
  blocks: number;
}

/** Surface → engine snapshot request SysEx (CONTRACTS §2.5). The engine sends it to every onMidiOut subscriber on subscription. */
export const SNAPSHOT_REQUEST: readonly number[] = [0xf0, 0x7d, 0x6b, 0x01, 0xf7];

/** Capacity problems of spec.audio against its board (the engine drops these channels). Empty = fine. */
export function capacityIssues(spec: DeviceSpec): string[] {
  const a = spec.audio;
  if (!a) return [];
  const board = AUDIO_BOARDS[a.board];
  if (!board) return [`Unknown audio board "${a.board}"`];
  return a.channels.slice(board.stereoChannels).map((c) => `Channel ${c.label} (${c.id}) is beyond the ${board.stereoChannels} stereo channels of ${board.name}; it is not processed`);
}

export const CHANNEL_PARAMS: ChannelParam[] = [
  'gain', 'eqHi', 'eqHiMid', 'eqLoMid', 'eqLo', 'filter', 'fxSend', 'pan', 'fader', 'mute', 'solo', 'cue', 'inputSelect',
];
export const MASTER_PARAMS: MasterParam[] = ['master', 'booth', 'phones', 'cueMix', 'fxReturn'];
/** Values before the surface says anything (CC units). */
export const CHANNEL_DEFAULTS: Record<ChannelParam, number> = {
  gain: 106, eqHi: 64, eqHiMid: 64, eqLoMid: 64, eqLo: 64, filter: 64, fxSend: 0, pan: 64, fader: 100,
  mute: 0, solo: 0, cue: 0, inputSelect: 0,
};
export const MASTER_DEFAULTS: Record<MasterParam, number> = { master: 100, booth: 127, phones: 90, cueMix: 64, fxReturn: 100 };

export interface MixerEngine {
  readonly sampleRate: number;
  readonly channelCount: number;
  /**
   * One block (any length ≤ outputs' length; the worklet uses 128). inputs[ch] = [L, R] (post-select), or
   * [AL, AR, BL, BR] for a combo module so the engine applies inputSelect. Missing/short = silence. Mono channels read only L (or AL/BL).
   */
  process(inputs: Float32Array[][], outputs: EngineOutputs): void;
  /** The surface's outgoing MIDI (3-byte channel messages). Returns true when a binding matched. */
  handleMidi(msg: ArrayLike<number>): boolean;
  /**
   * Engine → surface MIDI: meter CCs (~30 Hz, only changed values) and the boot snapshot request, which every new subscriber
   * receives immediately on subscribing (so the surface answers with all control positions).
   */
  onMidiOut(cb: (msg: number[]) => void): () => void;
  /** Send the snapshot request again (e.g. after the surface reconnects). */
  requestSnapshot(): void;
  /** Fires when a channel's inputSelect flips (drives the module's A/B switch). */
  onInputSelect(cb: (channel: number, sel: 'A' | 'B') => void): () => void;
  /** Direct control (UI / tests), CC units 0..127. */
  setParam(channel: number, param: ChannelParam, cc: number): void;
  setMasterParam(param: MasterParam, cc: number): void;
  setInputSelect(channel: number, sel: 'A' | 'B'): void;
  setTrimDb(channel: number, db: number): void;
  getParam(channel: number, param: ChannelParam): number;
  getMasterParam(param: MasterParam): number;
  getStats(): EngineStats;
}

// ---- helpers ----

const CLIP_LIN = dbToLin(CLIP_DB);
const METER_DECAY_S = 0.3; // falls 20 dB per 300 ms
const CLIP_HOLD_S = 1;

/** Peak with instant attack, 20 dB / 300 ms release, and a latched clip flag. */
class PeakMeter {
  p = 0;
  private clipLeft = 0;
  push(blockPeak: number, n: number, fs: number) {
    this.p = Math.max(blockPeak, this.p * 10 ** (-(n / fs) / METER_DECAY_S));
    this.clipLeft = blockPeak >= CLIP_LIN ? CLIP_HOLD_S * fs : Math.max(0, this.clipLeft - n);
  }
  get clip() { return this.clipLeft > 0; }
  stat(): StageStat { return { peakDb: linToDb(this.p), clip: this.clip }; }
}

/** Gain smoothed linearly across a block (same as AudioAmplifier's ramp). First use snaps. */
class Ramp {
  v = 0; g0 = 0; dg = 0; private init = false;
  to(t: number, n: number) {
    if (!this.init) { this.init = true; this.v = t; }
    this.g0 = this.v; this.dg = (t - this.v) / n; this.v = t;
  }
  at(k: number) { return this.g0 + this.dg * (k + 1); }
}

class Chan {
  p = { ...CHANNEL_DEFAULTS };
  trimA = 0; trimB = 0; selectable = false;
  active = true;
  get trim() { return this.selectable && this.p.inputSelect >= 64 ? this.trimB : this.trimA; }
  eq = [0, 1].map(() => EQ_BANDS.map(() => new Biquad()));
  flt = [new Biquad(), new Biquad()];
  eqApplied = [-1, -1, -1, -1];
  eqOn = [false, false, false, false];
  fltApplied = -1;
  fltOn = false;
  rGain = new Ramp(); rFader = new Ramp(); rPanL = new Ramp(); rPanR = new Ramp(); rSend = new Ramp();
  adc = new PeakMeter(); pre = new PeakMeter(); post = new PeakMeter();
  lastCc = -1;
  audible = true;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : NaN);

interface Bind { scope: 'ch' | 'master'; idx: number; param: string; ctl: Control }

export function createMixerEngine(spec: DeviceSpec, opts: EngineOptions = {}): MixerEngine {
  const fs = opts.sampleRate ?? SAMPLE_RATE;
  const meterPeriod = fs / (opts.meterHz ?? 30);
  const audio = spec.audio;
  const chDefs = audio?.channels ?? [];
  const board = audio && AUDIO_BOARDS[audio.board];
  if (audio && !board) throw new Error(`Unknown audio board "${audio.board}"`);
  const chans = chDefs.map((cd, i) => {
    const c = new Chan();
    const m = channelModule(spec, cd.id); // throws on unknown module / missing slot
    const a = m.inputs![0]!, b = m.inputs![1] ?? a;
    c.trimA = trimDbFor(m, a, opts.preampDb?.[cd.id]);
    c.trimB = trimDbFor(m, b, opts.preampDb?.[cd.id]);
    c.selectable = !!m.selectable && m.inputs!.length > 1;
    const o = opts.trimDb?.[i];
    if (o !== undefined) { c.trimA = c.trimB = o; }
    c.active = i < board!.stereoChannels;
    return c;
  });
  const mp = { ...MASTER_DEFAULTS };
  const ctlById = new Map(spec.controls.map((c) => [c.id, c]));

  // MIDI target → binding list. Key: 'c'|'n' + channel(1-16) + ':' + number.
  const binds = new Map<string, Bind[]>();
  const addBind = (scope: Bind['scope'], idx: number, param: string, ctlId: string | undefined) => {
    const ctl = ctlId ? ctlById.get(ctlId) : undefined;
    if (!ctl) return;
    const m = ctl.midi;
    const key = m.type === 'note' ? `n${m.channel}:${m.note}` : `c${m.channel}:${m.cc}`;
    (binds.get(key) ?? binds.set(key, []).get(key)!).push({ scope, idx, param, ctl });
  };
  chDefs.forEach((c, i) => Object.entries(c.bind).forEach(([p, id]) => addBind('ch', i, p, id)));
  Object.entries(audio?.master.bind ?? {}).forEach(([p, id]) => addBind('master', 0, p, id));

  // Meter feed: surface Meter id → its (channel, cc).
  const meterMidi = (id?: string) => spec.meters?.find((m) => m.id === id)?.midi;
  const chMeter = chDefs.map((c) => meterMidi(c.meter));
  const mMeter = [meterMidi(audio?.master.meters?.left), meterMidi(audio?.master.meters?.right)];
  const mLast = [-1, -1];
  const mPk = [new PeakMeter(), new PeakMeter()];

  const outSubs = new Set<(m: number[]) => void>();
  const selSubs = new Set<(c: number, s: 'A' | 'B') => void>();
  const reverb = new Reverb();
  const rMaster = new Ramp(), rFxRet = new Ramp(), rBooth = new Ramp(), rPhones = new Ramp(), rCue = new Ramp(), rMon = new Ramp();
  let meterAcc = 0, cpu = 0, blocks = 0;

  // scratch (grown on demand)
  let cap = 0;
  const z64 = new Float64Array(0), z32 = new Float32Array(0);
  let aL: Float64Array = z64, aR = z64, bL = z64, bR = z64, cL = z64, cR = z64;
  let wetL: Float32Array = z32, wetR = z32, fxInL = z32, fxInR = z32;
  const zeros = new Float32Array(BLOCK);
  const grow = (n: number) => {
    if (n <= cap) return;
    cap = n;
    aL = new Float64Array(n); aR = new Float64Array(n); bL = new Float64Array(n); bR = new Float64Array(n);
    cL = new Float64Array(n); cR = new Float64Array(n);
    wetL = new Float32Array(n); wetR = new Float32Array(n); fxInL = new Float32Array(n); fxInR = new Float32Array(n);
  };

  const anySolo = () => chans.some((c) => c.p.solo >= 64);
  const lin = (db: number) => (db === -Infinity ? 0 : dbToLin(db));

  function refreshFilters(c: Chan) {
    EQ_BANDS.forEach((band, b) => {
      const cc = c.p[band.param];
      if (cc === c.eqApplied[b]) return;
      c.eqApplied[b] = cc;
      const db = eqDb(cc);
      c.eqOn[b] = db !== 0;
      for (const side of c.eq) side[b]!.c = db !== 0 ? band.make(db, fs) : IDENTITY;
    });
    if (c.p.filter !== c.fltApplied) {
      c.fltApplied = c.p.filter;
      const f = filterMode(c.p.filter);
      c.fltOn = f.mode !== 'off';
      const co = f.mode === 'lp' ? lowpass(f.freq, FILTER_Q, fs) : f.mode === 'hp' ? highpass(f.freq, FILTER_Q, fs) : IDENTITY;
      for (const b of c.flt) b.c = co;
    }
  }

  function process(inputs: Float32Array[][], out: EngineOutputs) {
    const t0 = now();
    const n = out.master[0].length;
    grow(n);
    const solo = anySolo();
    cL.fill(0, 0, n); cR.fill(0, 0, n); // cue bus
    bL.fill(0, 0, n); bR.fill(0, 0, n); // master bus
    fxInL.fill(0, 0, n); fxInR.fill(0, 0, n);

    chans.forEach((c, i) => {
      if (!c.active) return;
      refreshFilters(c);
      const inp = inputs[i] ?? [];
      const sel = c.selectable && c.p.inputSelect >= 64 && inp.length >= 4;
      const sL = (sel ? inp[2] : inp[0]) ?? zeros;
      const sR = chDefs[i]!.stereo ? ((sel ? inp[3] : inp[1]) ?? zeros) : sL;
      const trim = dbToLin(c.trim);
      let pk = 0;
      const rg = c.rGain; rg.to(lin(gainDb(c.p.gain)), n);
      for (let k = 0; k < n; k++) {
        const l = sL[k]! * trim, r = sR[k]! * trim;
        pk = Math.max(pk, Math.abs(l), Math.abs(r));
        const g = rg.at(k);
        aL[k] = Math.max(-1, Math.min(1, l)) * g; // ADC clamps at full scale
        aR[k] = Math.max(-1, Math.min(1, r)) * g;
      }
      c.adc.push(pk, n, fs);
      for (let b = 0; b < 4; b++) {
        if (!c.eqOn[b]) continue;
        c.eq[0]![b]!.process(aL, aL, n);
        c.eq[1]![b]!.process(aR, aR, n);
      }
      if (c.fltOn) {
        c.flt[0]!.process(aL, aL, n);
        c.flt[1]!.process(aR, aR, n);
      }
      pk = 0;
      for (let k = 0; k < n; k++) pk = Math.max(pk, Math.abs(aL[k]!), Math.abs(aR[k]!));
      c.pre.push(pk, n, fs);
      if (c.p.cue >= 64) for (let k = 0; k < n; k++) { cL[k]! += aL[k]!; cR[k]! += aR[k]!; } // PFL: pre-fader, ignores mute/solo

      const rf = c.rFader; rf.to(lin(faderDb(c.p.fader)), n);
      pk = 0;
      for (let k = 0; k < n; k++) {
        const g = rf.at(k);
        aL[k]! *= g; aR[k]! *= g;
        pk = Math.max(pk, Math.abs(aL[k]!), Math.abs(aR[k]!));
      }
      c.post.push(pk, n, fs);

      c.audible = c.p.mute < 64 && (!solo || c.p.solo >= 64);
      const [pl, pr] = chDefs[i]!.stereo ? panBalance(c.p.pan) : panMono(c.p.pan);
      c.rPanL.to(c.audible ? pl : 0, n); c.rPanR.to(c.audible ? pr : 0, n);
      c.rSend.to(lin(levelDb(c.p.fxSend)), n);
      for (let k = 0; k < n; k++) {
        const l = aL[k]! * c.rPanL.at(k), r = aR[k]! * c.rPanR.at(k), s = c.rSend.at(k);
        bL[k]! += l; bR[k]! += r;
        fxInL[k]! += l * s; fxInR[k]! += r * s;
      }
    });

    reverb.process(fxInL, fxInR, wetL, wetR, n);
    rFxRet.to(lin(levelDb(mp.fxReturn)), n);
    rMaster.to(lin(faderDb(mp.master)), n);
    rBooth.to(lin(levelDb(mp.booth)), n);
    rPhones.to(lin(levelDb(mp.phones)), n);
    const [gc, gm] = cueMixGains(mp.cueMix);
    rCue.to(gc, n); rMon.to(gm, n);
    let pkL = 0, pkR = 0;
    for (let k = 0; k < n; k++) {
      const fr = rFxRet.at(k), g = rMaster.at(k);
      const mL = (bL[k]! + wetL[k]! * fr) * g, mR = (bR[k]! + wetR[k]! * fr) * g;
      pkL = Math.max(pkL, Math.abs(mL)); pkR = Math.max(pkR, Math.abs(mR));
      const clamp = (x: number) => Math.max(-1, Math.min(1, x));
      out.master[0][k] = clamp(mL); out.master[1][k] = clamp(mR);
      const bo = rBooth.at(k);
      out.booth[0][k] = clamp(mL * bo); out.booth[1][k] = clamp(mR * bo);
      const ph = rPhones.at(k), cu = rCue.at(k), mo = rMon.at(k);
      out.phones[0][k] = clamp((cL[k]! * cu + mL * mo) * ph); out.phones[1][k] = clamp((cR[k]! * cu + mR * mo) * ph);
    }
    mPk[0]!.push(pkL, n, fs); mPk[1]!.push(pkR, n, fs);

    meterAcc += n;
    if (meterAcc >= meterPeriod) {
      meterAcc -= meterPeriod;
      const send = (m: { channel: number; cc: number } | undefined, v: number) => {
        const msg = [0xb0 | ((m?.channel ?? 1) - 1), m?.cc ?? 0, v];
        if (m) outSubs.forEach((cb) => cb(msg));
      };
      chans.forEach((c, i) => {
        const v = meterCc(linToDb(c.post.p));
        if (v !== c.lastCc) { c.lastCc = v; send(chMeter[i], v); }
      });
      mPk.forEach((pk, s) => {
        const v = meterCc(linToDb(pk.p));
        if (v !== mLast[s]) { mLast[s] = v; send(mMeter[s], v); }
      });
    }
    blocks++;
    const dt = now() - t0;
    if (!Number.isNaN(dt)) cpu += (dt / ((n / fs) * 1000) - cpu) * 0.05;
  }

  function setParam(ch: number, param: ChannelParam, cc: number) {
    const c = chans[ch];
    if (!c || !(param in CHANNEL_DEFAULTS)) return;
    const v = Math.max(0, Math.min(127, Math.round(cc)));
    const was = c.p[param];
    c.p[param] = v;
    if (param === 'inputSelect' && (was >= 64) !== (v >= 64)) selSubs.forEach((cb) => cb(ch, v >= 64 ? 'B' : 'A'));
  }
  function setMasterParam(param: MasterParam, cc: number) {
    if (param in mp) mp[param] = Math.max(0, Math.min(127, Math.round(cc)));
  }

  const BOOL = new Set<string>(['mute', 'solo', 'cue', 'inputSelect']);
  function handleMidi(msg: ArrayLike<number>): boolean {
    const st = (msg[0] ?? 0) & 0xf0, ch = ((msg[0] ?? 0) & 0x0f) + 1;
    const d1 = (msg[1] ?? 0) & 0x7f, d2 = (msg[2] ?? 0) & 0x7f;
    let list: Bind[] | undefined, on: boolean, v = d2;
    if (st === 0x90 || st === 0x80) { list = binds.get(`n${ch}:${d1}`); on = st === 0x90 && d2 > 0; }
    else if (st === 0xb0) { list = binds.get(`c${ch}:${d1}`); on = d2 >= 64; }
    else return false;
    if (!list) return false;
    for (const b of list) {
      let cc: number;
      const m = b.ctl.midi;
      if (st !== 0xb0 || b.ctl.kind === 'button') cc = on ? 127 : 0; // button: follow its ON/OFF state
      else {
        const span = (m as { max: number }).max - (m as { min: number }).min;
        cc = span === 0 ? v : Math.round(Math.max(0, Math.min(1, (v - (m as { min: number }).min) / span)) * 127);
      }
      if (BOOL.has(b.param)) cc = cc >= 64 ? 127 : 0;
      if (b.scope === 'ch') setParam(b.idx, b.param as ChannelParam, cc);
      else setMasterParam(b.param as MasterParam, cc);
    }
    return true;
  }

  return {
    sampleRate: fs,
    channelCount: chans.length,
    process,
    handleMidi,
    onMidiOut(cb) {
      outSubs.add(cb);
      cb([...SNAPSHOT_REQUEST]);
      return () => void outSubs.delete(cb);
    },
    requestSnapshot() { outSubs.forEach((cb) => cb([...SNAPSHOT_REQUEST])); },
    onInputSelect(cb) { selSubs.add(cb); return () => void selSubs.delete(cb); },
    setParam,
    setMasterParam,
    setInputSelect: (ch, sel) => setParam(ch, 'inputSelect', sel === 'B' ? 127 : 0),
    setTrimDb(ch, db) { const c = chans[ch]; if (c) c.trimA = c.trimB = db; },
    getParam: (ch, p) => chans[ch]?.p[p] ?? 0,
    getMasterParam: (p) => mp[p],
    getStats() {
      const solo = anySolo();
      return {
        channels: chans.map((c, i) => ({
          id: chDefs[i]!.id,
          active: c.active, input: c.selectable && c.p.inputSelect >= 64 ? 'B' : 'A', trimDb: c.trim,
          adc: c.adc.stat(), pre: c.pre.stat(), post: c.post.stat(),
          clip: c.adc.clip || c.pre.clip || c.post.clip,
          meterCc: meterCc(linToDb(c.post.p)),
          audible: c.p.mute < 64 && (!solo || c.p.solo >= 64),
        })),
        master: { left: mPk[0]!.stat(), right: mPk[1]!.stat(), meterCc: [meterCc(linToDb(mPk[0]!.p)), meterCc(linToDb(mPk[1]!.p))] },
        anySolo: solo,
        overCapacity: chDefs.filter((_, i) => !chans[i]!.active).map((c) => c.id),
        cpu,
        blocks,
      };
    },
  };
}
