import type { DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';
import type { WorkerIn, WorkerOut } from './workerRuntime';

export interface WorkerStats {
  simMsPerWallMs: number;
  lagMs: number;
}

export type WorkerSim = DeviceSim & {
  stats(cb: (s: WorkerStats) => void): () => void;
  dispose(): void;
  product: string;
};

/**
 * Runs the real firmware in a Web Worker. fidelity 'firmware', **real-time**: the worker paces itself against the
 * wall clock, so `advance(ms)` is a no-op that resolves immediately; stimulus applies at the worker's current sim
 * time; `onMidi` timeMs is the worker's simulated ms since boot.
 *
 *   createRp2040WorkerSim(spec, fw, opts, () => new Worker(new URL('@kontrolla/emulator/worker', import.meta.url), { type: 'module' }))
 */
export function createRp2040WorkerSim(
  spec: DeviceSpec,
  firmwareBin: Uint8Array,
  opts: SimOptions | undefined,
  makeWorker: () => Worker,
): Promise<WorkerSim> {
  const worker = makeWorker();
  const midi = new Set<(msg: number[], timeMs: number) => void>();
  const stats = new Set<(s: WorkerStats) => void>();
  const leds = new Set<(rgb: Uint8Array, timeMs: number) => void>();
  const send = (m: WorkerIn, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

  return new Promise((resolve, reject) => {
    let product = '';
    let ready = false;
    const sim: WorkerSim = {
      fidelity: 'firmware',
      get product() {
        return product;
      },
      setAnalog: (id, value) => send({ type: 'setAnalog', id, value }),
      setButton: (id, pressed) => send({ type: 'setButton', id, pressed }),
      turnEncoder: (id, detents) => send({ type: 'turnEncoder', id, detents }),
      advance: () => Promise.resolve(),
      sendMidi: (msg) => send({ type: 'sendMidi', msg }),
      onLeds(cb) {
        leds.add(cb);
        return () => void leds.delete(cb);
      },
      onMidi(cb) {
        midi.add(cb);
        return () => void midi.delete(cb);
      },
      stats(cb) {
        stats.add(cb);
        return () => void stats.delete(cb);
      },
      dispose: () => worker.terminate(),
    };
    const fail = (message: string) => {
      if (ready) return console.error('[emulator worker]', message);
      worker.terminate();
      reject(new Error(message));
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'ready') {
        product = m.product;
        ready = true;
        resolve(sim);
        // Next macrotask: after the caller's synchronous setup, so stimulus set right after creation is the power-on state.
        setTimeout(() => send({ type: 'run' }), 0);
      } else if (m.type === 'midi') m.events.forEach((ev) => midi.forEach((cb) => cb(ev.msg, ev.timeMs)));
      else if (m.type === 'leds') leds.forEach((cb) => cb(m.rgb, m.timeMs));
      else if (m.type === 'stats') stats.forEach((cb) => cb(m));
      else fail(m.message);
    };
    worker.onerror = (e) => fail(e.message || 'worker error');
    const fw = firmwareBin.slice().buffer; // copy: the caller keeps its bytes
    send({ type: 'init', spec, firmwareBin: fw, opts }, [fw]);
  });
}
