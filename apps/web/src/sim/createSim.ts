import { createModelDevice } from '@kontrolla/core';
import type { DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';

/**
 * The one place the UI creates a simulator. Everything else depends only on the DeviceSim interface.
 *
 * TODO: for 'rp2040-pico', return the instruction-level RP2040 emulator (Web Worker, fidelity 'firmware')
 * loaded with the prebuilt firmware image + encodeConfig(spec). Until then both boards use the model.
 */
export async function createSim(spec: DeviceSpec, opts: SimOptions): Promise<DeviceSim> {
  return createModelDevice(spec, opts);
}
