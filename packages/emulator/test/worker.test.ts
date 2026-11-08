import { expect, test } from 'bun:test';
import { allocatePins, EXAMPLES } from '@kontrolla/core';
import { createRp2040WorkerSim } from '../src';
import { firmware } from './helpers';

test('worker smoke: init starter, setAnalog -> CC within 2 s wall', async () => {
  const spec = allocatePins(EXAMPLES.starter!);
  const sim = await createRp2040WorkerSim(spec, firmware, undefined, () => new Worker(new URL('../src/worker.ts', import.meta.url), { type: 'module' }));
  try {
    expect(sim.product).toBe('kont.rolla Starter');
    const got = new Promise<number[]>((res) => sim.onMidi((m) => m[0] === 0xb0 && res(m)));
    await new Promise((r) => setTimeout(r, 100)); // let the baseline scan happen
    sim.setAnalog('pot1', 1);
    const msg = await Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no MIDI in 2 s')), 2000))]);
    expect(msg[1]).toBe(21);
    const stats = await new Promise<{ simMsPerWallMs: number }>((res) => sim.stats(res));
    expect(stats.simMsPerWallMs).toBeGreaterThan(0.8); // real-time: ~1.0
  } finally {
    sim.dispose();
  }
}, 10000);
