import { createModelDevice } from '@kontrolla/core';
import type { DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';
import { createRp2040WorkerSim } from '@kontrolla/emulator';
import { fetchFirmwareBin } from './firmware';

export type AppSim = DeviceSim & { dispose(): void };

/**
 * The one place the UI creates a simulator. Everything else depends only on the DeviceSim interface.
 * Pico: the real firmware image, instruction-level in a Web Worker (self-paced; advance() is a no-op).
 * Teensy: the behavioural model.
 */
export async function createSim(spec: DeviceSpec, opts: SimOptions, forceModel = false): Promise<AppSim> {
  if (spec.mcu === 'rp2040-pico' && !forceModel) {
    return createRp2040WorkerSim(spec, await fetchFirmwareBin(), opts, () =>
      new Worker(new URL('@kontrolla/emulator/worker', import.meta.url), { type: 'module' }),
    );
  }
  return Object.assign(createModelDevice(spec, opts), { dispose() {} });
}
