import { OUTPUT, SOURCES, createAudioEngineNode, renderSource, toAudioBuffer, trimDbFor } from '@kontrolla/audio';
import type { AudioEngineNode, EngineStats, SourceId } from '@kontrolla/audio';
import { IO_MODULES, moduleOfSlot } from '@kontrolla/core';
import type { DeviceSpec, IoModule } from '@kontrolla/core';
import workletUrl from './worklet?worker&url';
import type { Bench } from '../bench';

export type SourceSel =
  | { kind: 'none' }
  | { kind: 'demo'; id: SourceId }
  | { kind: 'file'; name: string; buffer: AudioBuffer }
  | { kind: 'live'; deviceId: string; label: string };
export type InputSet = 'A' | 'B';
export type Bus = keyof typeof OUTPUT;
export const BUSES: Bus[] = ['master', 'booth', 'phones'];

/** How hot a demo / file / live source is at the jack: its peak sits this far above the module's nominal level. */
const HOT_DB = 6;
const DEMO_PEAK = 0.5; // the demo sources peak at -6 dBFS
const START_VOLUME = 0.15; // "start quiet"

const dbLin = (db: number) => 10 ** (db / 20);
const peakDb = (a: Float32Array) => {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m > 0 ? 20 * Math.log10(m) : -Infinity;
};

interface Chan {
  id: string;
  module: IoModule;
  sources: Record<InputSet, SourceSel>;
  active: InputSet;
  levelDb: number; // source level offset at the jack
  preampDb: number | undefined;
  jack: GainNode; // source scaling, into the engine input
  node: AudioScheduledSourceNode | MediaStreamAudioSourceNode | null;
  stream: MediaStream | null;
}

export interface Rig {
  readonly ctx: AudioContext;
  /** null while no simulator is attached (it rebuilds when the design changes). */
  engine(): AudioEngineNode | null;
  channels(): readonly Chan[];
  playing(): boolean;
  monitor(): Bus;
  volume(): number;
  calibrating(): boolean;
  sinkId(): string;
  /** Called whenever anything the UI shows changed (sources, play state, A/B, monitor). */
  onChange(cb: () => void): () => void;
  onStats(cb: (s: EngineStats) => void): () => void;
  stats(): EngineStats | null;
  bind(bench: Bench): void;
  unbind(): void;
  setSource(ch: number, set: InputSet, s: SourceSel): Promise<void>;
  setSourceFile(ch: number, set: InputSet, file: File): Promise<void>;
  setLevelDb(ch: number, db: number): void;
  setPreampDb(ch: number, db: number): void;
  play(): void;
  stop(): void;
  setMonitor(b: Bus): void;
  setVolume(v: number): void;
  /** Feed every source so the ADC sees its own amplitude (tone1k = -18 dBFS), whatever the module's gain. For the auto-test. */
  setCalibration(on: boolean): void;
  /** Instant peak (dBFS) at the engine outputs, left and right. */
  busPeak(b: Bus): [number, number];
  outputDevices(): Promise<MediaDeviceInfo[]>;
  inputDevices(): Promise<MediaDeviceInfo[]>;
  setSinkId(id: string): Promise<void>;
  canSetSink: boolean;
  dispose(): void;
}

/** One AudioContext, one set of per-channel jacks, the monitoring chain; the engine node is rebuilt per attached simulator. */
export function createRig(spec: DeviceSpec): Rig {
  const ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
  const a = spec.audio!;
  const listeners = new Set<() => void>();
  const statSubs = new Set<(s: EngineStats) => void>();
  const changed = () => listeners.forEach((f) => f());

  // output: bus taps -> gate (monitor choice) -> volume -> limiter -> speakers
  const vol = ctx.createGain();
  vol.gain.value = START_VOLUME;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  vol.connect(limiter).connect(ctx.destination);
  const gates = BUSES.map(() => {
    const g = ctx.createGain();
    g.connect(vol);
    return g;
  });
  const analysers = BUSES.map(() => [0, 1].map(() => Object.assign(ctx.createAnalyser(), { fftSize: 2048 })) as [AnalyserNode, AnalyserNode]);
  const scratch = new Float32Array(2048);

  const chans: Chan[] = a.channels.map((c) => {
    const mid = moduleOfSlot(spec, c.slot);
    const module = IO_MODULES[mid ?? '']!;
    const jack = ctx.createGain();
    jack.channelCount = 2;
    jack.channelCountMode = 'explicit';
    return { id: c.id, module, sources: { A: { kind: 'none' }, B: { kind: 'none' } }, active: 'A', levelDb: 0, preampDb: undefined, jack, node: null, stream: null };
  });

  // Play should make a sound: the first two channels start with a drum loop and a bass line
  (['drums', 'bass'] as const).forEach((id, i) => chans[i] && (chans[i]!.sources.A = { kind: 'demo', id }));

  let eng: AudioEngineNode | null = null;
  let stats: EngineStats | null = null;
  let offs: (() => void)[] = [];
  let cancel = () => {};
  let playing = false;
  let monitor: Bus = 'master';
  let calibrating = false;
  let sink = '';
  const buffers = new Map<SourceId, AudioBuffer>();

  const inputOf = (c: Chan, set: InputSet) => c.module.inputs?.find((i) => i.id === set) ?? c.module.inputs?.[0];
  /** Net analogue gain jack -> ADC of the active input right now (what the engine applies). */
  const trimNow = (c: Chan) => {
    const inp = inputOf(c, c.active);
    return inp ? trimDbFor(c.module, inp, c.module.gainRangeDb ? c.preampDb ?? inp.preampDb : inp.preampDb) : 0;
  };
  const refreshJack = (c: Chan) => {
    const inp = inputOf(c, c.active);
    // calibration: source amplitude lands on the ADC unchanged. Otherwise: peaks HOT_DB above the nominal level of this input.
    const db = calibrating ? -trimNow(c) : (inp?.nominalDbV ?? -10) + HOT_DB + c.levelDb;
    c.jack.gain.value = calibrating ? dbLin(db) : dbLin(db) / DEMO_PEAK;
  };

  const stopChan = (c: Chan) => {
    try { (c.node as AudioScheduledSourceNode | null)?.stop?.(); } catch { /* already stopped */ }
    c.node?.disconnect();
    c.node = null;
  };
  const startChan = (c: Chan, when: number) => {
    stopChan(c);
    refreshJack(c);
    const s = c.sources[c.active];
    if (s.kind === 'none') return;
    if (s.kind === 'live') {
      if (!c.stream) return;
      const n = ctx.createMediaStreamSource(c.stream);
      n.connect(c.jack);
      c.node = n;
      return;
    }
    const buf = s.kind === 'file' ? s.buffer : (buffers.get(s.id) ?? buffers.set(s.id, toAudioBuffer(ctx, renderSource(s.id, ctx.sampleRate))).get(s.id)!);
    const n = ctx.createBufferSource();
    n.buffer = buf;
    n.loop = s.kind === 'file' || SOURCES[s.id].loop;
    n.connect(c.jack);
    n.start(when);
    c.node = n;
  };
  const restart = (c: Chan) => {
    if (playing) startChan(c, ctx.currentTime);
    else (stopChan(c), refreshJack(c));
  };
  const releaseStream = (c: Chan) => {
    c.stream?.getTracks().forEach((t) => t.stop());
    c.stream = null;
  };

  const rig: Rig = {
    ctx,
    engine: () => eng,
    channels: () => chans,
    playing: () => playing,
    monitor: () => monitor,
    volume: () => vol.gain.value,
    calibrating: () => calibrating,
    sinkId: () => sink,
    onChange: (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    onStats: (cb) => (statSubs.add(cb), () => void statSubs.delete(cb)),
    stats: () => stats,
    canSetSink: typeof (ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function',

    bind(bench) {
      rig.unbind();
      const sim = bench.sim;
      let dead = false;
      cancel = () => (dead = true);
      void createAudioEngineNode(ctx, bench.spec, chans.map((c) => c.jack), { workletUrl }).then((e) => {
        if (dead) return e.dispose();
        eng = e;
        // the real firmware's UART port <-> the engine: knobs and buttons go in, meter CCs come back as LEDs
        offs = [
          sim.onPortMidi?.((msg) => e.sendMidi(msg)) ?? (() => {}),
          e.onMidiOut((msg) => sim.sendPortMidi?.(msg)),
          e.onInputSelect((ch, sel) => {
            const c = chans[ch];
            if (!c) return;
            c.active = sel;
            restart(c);
            changed();
          }),
          e.onStats((s) => ((stats = s), statSubs.forEach((f) => f(s)))),
        ];
        BUSES.forEach((b, i) => {
          const o = OUTPUT[b];
          const split = ctx.createChannelSplitter(2);
          e.node.connect(split, o);
          split.connect(analysers[i]![0], 0);
          split.connect(analysers[i]![1], 1);
          e.node.connect(gates[i]!, o);
          gates[i]!.gain.value = b === monitor ? 1 : 0;
        });
        chans.forEach((c, i) => c.preampDb !== undefined && rig.setPreampDb(i, c.preampDb));
        // boot sync: the surface sends nothing at power-on, so ask it for the state of every knob and switch
        sim.sendPortMidi?.([0xf0, 0x7d, 0x6b, 0x01, 0xf7]);
        changed();
      });
    },
    unbind() {
      cancel();
      offs.forEach((f) => f());
      offs = [];
      if (eng) {
        chans.forEach((c) => c.jack.disconnect());
        eng.dispose();
      }
      eng = null;
      stats = null;
      changed();
    },

    async setSource(i, set, s) {
      const c = chans[i]!;
      if (c.sources[set].kind === 'live' && (s.kind !== 'live' || s.deviceId !== (c.sources[set] as { deviceId: string }).deviceId) && c.active === set) releaseStream(c);
      if (s.kind === 'live') {
        releaseStream(c);
        c.stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: s.deviceId ? { exact: s.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      c.sources[set] = s;
      if (set === c.active) restart(c);
      changed();
    },
    async setSourceFile(i, set, file) {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      await rig.setSource(i, set, { kind: 'file', name: file.name, buffer });
    },
    setLevelDb(i, db) {
      chans[i]!.levelDb = db;
      refreshJack(chans[i]!);
      changed();
    },
    setPreampDb(i, db) {
      const c = chans[i]!;
      c.preampDb = db;
      const inp = inputOf(c, 'A');
      if (c.module.gainRangeDb && inp) eng?.setTrimDb(i, trimDbFor(c.module, inp, db));
      refreshJack(c);
      changed();
    },

    play() {
      void ctx.resume();
      playing = true;
      const when = ctx.currentTime + 0.05;
      chans.forEach((c) => startChan(c, when));
      changed();
    },
    stop() {
      playing = false;
      chans.forEach(stopChan);
      changed();
    },
    setMonitor(b) {
      monitor = b;
      BUSES.forEach((x, i) => (gates[i]!.gain.value = x === b ? 1 : 0));
      changed();
    },
    setVolume(v) {
      vol.gain.value = Math.min(1, Math.max(0, v));
      changed();
    },
    setCalibration(on) {
      calibrating = on;
      chans.forEach(refreshJack);
    },
    busPeak(b) {
      const [l, r] = analysers[BUSES.indexOf(b)]!;
      l.getFloatTimeDomainData(scratch as Float32Array<ArrayBuffer>);
      const pl = peakDb(scratch);
      r.getFloatTimeDomainData(scratch as Float32Array<ArrayBuffer>);
      return [pl, peakDb(scratch)];
    },
    async outputDevices() {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    },
    async inputDevices() {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    },
    async setSinkId(id) {
      await (ctx as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(id);
      sink = id;
      changed();
    },
    dispose() {
      rig.unbind();
      chans.forEach((c) => (stopChan(c), releaseStream(c)));
      listeners.clear();
      statSubs.clear();
      void ctx.close();
    },
  };
  chans.forEach(refreshJack);
  return rig;
}

export type { Chan };
