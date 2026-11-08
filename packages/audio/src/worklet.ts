// AudioWorkletProcessor around the engine. N stereo inputs (one per channel) → 3 stereo outputs [master, booth, phones].
// Port protocol (client.ts is the only user):
//   in : { t:'midi', msg:number[] } | { t:'param', ch, param, cc } | { t:'master', param, cc } | { t:'trim', ch, db }
//   out: { t:'midi', msg:number[] } | { t:'stats', stats } | { t:'insel', ch, sel:'A'|'B' }
import type { DeviceSpec } from '@kontrolla/core';
import { createMixerEngine, type MixerEngine } from './engine';

export const PROCESSOR_NAME = 'kontrolla-mixer';
const STATS_EVERY_BLOCKS = 12; // ≈ 35 ms

class MixerProcessor extends AudioWorkletProcessor {
  private engine: MixerEngine;
  private n = 0;
  constructor(options: { processorOptions?: unknown }) {
    super(options);
    const o = options.processorOptions as { spec: DeviceSpec; trimDb?: number[] };
    this.engine = createMixerEngine(o.spec, { sampleRate, trimDb: o.trimDb });
    this.engine.onMidiOut((msg) => this.port.postMessage({ t: 'midi', msg }));
    this.engine.onInputSelect((ch, sel) => this.port.postMessage({ t: 'insel', ch, sel }));
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.t === 'midi') this.engine.handleMidi(m.msg);
      else if (m.t === 'param') this.engine.setParam(m.ch, m.param, m.cc);
      else if (m.t === 'master') this.engine.setMasterParam(m.param, m.cc);
      else if (m.t === 'trim') this.engine.setTrimDb(m.ch, m.db);
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [master, booth, phones] = outputs;
    if (!master?.[1] || !booth?.[1] || !phones?.[1]) return true;
    this.engine.process(inputs, {
      master: [master[0]!, master[1]], booth: [booth[0]!, booth[1]], phones: [phones[0]!, phones[1]],
    });
    if (++this.n % STATS_EVERY_BLOCKS === 0) this.port.postMessage({ t: 'stats', stats: this.engine.getStats() });
    return true;
  }
}
registerProcessor(PROCESSOR_NAME, MixerProcessor);
