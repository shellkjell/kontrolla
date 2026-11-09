// Main-thread helper: loads the worklet and wires per-channel inputs. Browser only.
import type { ChannelParam, DeviceSpec, MasterParam } from '@kontrolla/core';
import type { EngineStats } from './engine';

export const OUTPUT = { master: 0, booth: 1, phones: 2 } as const;
const PROCESSOR_NAME = 'kontrolla-mixer'; // keep equal to worklet.ts PROCESSOR_NAME (importing it would pull worklet globals in)

export interface AudioEngineNode {
  /** N inputs (one per channel, stereo), 3 outputs: connect(dest, OUTPUT.master | booth | phones). */
  node: AudioWorkletNode;
  /** The surface's outgoing MIDI (e.g. DeviceSim.onMidi / onPortMidi). */
  sendMidi(msg: number[]): void;
  /**
   * Engine → surface MIDI (feed DeviceSim.sendPortMidi): meter CCs, and the boot snapshot request SysEx `F0 7D 6B 01 F7`.
   * A subscriber added after boot still receives the boot request once (replayed on subscription).
   */
  onMidiOut(cb: (msg: number[]) => void): () => void;
  /** Ask the surface for a fresh snapshot of every control (CONTRACTS §2.5). */
  requestSnapshot(): void;
  onInputSelect(cb: (channel: number, sel: 'A' | 'B') => void): () => void;
  onStats(cb: (s: EngineStats) => void): () => void;
  /** Latest stats snapshot (~30 Hz), null before the first. */
  stats(): EngineStats | null;
  setParam(channel: number, param: ChannelParam, cc: number): void;
  setMasterParam(param: MasterParam, cc: number): void;
  setTrimDb(channel: number, db: number): void;
  dispose(): void;
}

export interface ClientOptions {
  trimDb?: (number | undefined)[];
  preampDb?: Record<string, number>;
  /** URL of the bundled worklet. Vite: `import u from '@kontrolla/audio/worklet?worker&url'`. Default: ./worklet.ts next to this file. */
  workletUrl?: string | URL;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

export async function createAudioEngineNode(
  ctx: BaseAudioContext, spec: DeviceSpec, inputs: (AudioNode | null | undefined)[], opts: ClientOptions = {},
): Promise<AudioEngineNode> {
  const url = opts.workletUrl ?? new URL('./worklet.ts', import.meta.url);
  if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(String(url)));
  await loaded.get(ctx);
  const n = spec.audio?.channels.length ?? 0;
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: n, numberOfOutputs: 3, outputChannelCount: [2, 2, 2],
    channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: { spec, trimDb: opts.trimDb, preampDb: opts.preampDb },
  });
  inputs.forEach((src, i) => src && i < n && src.connect(node, 0, i));

  const midi = new Set<(m: number[]) => void>(), sel = new Set<(c: number, s: 'A' | 'B') => void>(), st = new Set<(s: EngineStats) => void>();
  let last: EngineStats | null = null, boot: number[] | null = null;
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'midi') {
      if (m.msg[0] === 0xf0) boot ??= m.msg;
      midi.forEach((cb) => cb(m.msg));
    }
    else if (m.t === 'insel') sel.forEach((cb) => cb(m.ch, m.sel));
    else if (m.t === 'stats') { last = m.stats; st.forEach((cb) => cb(m.stats)); }
  };
  const sub = <T>(set: Set<T>, cb: T) => (set.add(cb), () => void set.delete(cb));
  return {
    node,
    sendMidi: (msg) => node.port.postMessage({ t: 'midi', msg }),
    onMidiOut: (cb) => {
      if (boot) cb(boot);
      return sub(midi, cb);
    },
    requestSnapshot: () => node.port.postMessage({ t: 'snapshot' }),
    onInputSelect: (cb) => sub(sel, cb),
    onStats: (cb) => sub(st, cb),
    stats: () => last,
    setParam: (ch, param, cc) => node.port.postMessage({ t: 'param', ch, param, cc }),
    setMasterParam: (param, cc) => node.port.postMessage({ t: 'master', param, cc }),
    setTrimDb: (ch, db) => node.port.postMessage({ t: 'trim', ch, db }),
    dispose() {
      node.disconnect();
      node.port.close();
      midi.clear(); sel.clear(); st.clear();
    },
  };
}
