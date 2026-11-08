// DeviceSim backed by the real RP2040 firmware (rp2040js). Stimulus comes from core's shared physics layer.
import { encodeConfig, Stimulus } from '@kontrolla/core';
import type { DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';
import { Rp2040Rig, type UsbState } from './rig';

export type Rp2040Device = Required<DeviceSim> & { readonly product: string; readonly usbState: UsbState };

const BOOT_LIMIT_MS = 2000;

/**
 * Boots the firmware and stops as soon as USB is configured, i.e. just before its first scan (which latches baselines,
 * CONTRACTS §2); stimulus set before the first `advance` is therefore the baseline. Simulated time starts at 0 here.
 * `advance` runs synchronously in 1 ms slices; call it with small `ms` from a UI loop.
 */
export async function createRp2040Device(spec: DeviceSpec, firmwareBin: Uint8Array, opts: SimOptions = {}): Promise<Rp2040Device> {
  const stim = new Stimulus(spec, opts);
  const rig = new Rp2040Rig(firmwareBin, encodeConfig(spec));
  const { rp } = rig;

  // A SIG pin is driven by the single enabled mux sharing it (muxes without an EN pin are always enabled).
  // None or several enabled: an analog read gives 0, a digital pin floats high. Validation prevents both.
  const selected = (m: DeviceSpec['muxes'][number]) => m.selectPins.reduce((a, p, i) => a | (rp.gpio[p]!.outputValue ? 1 << i : 0), 0);
  const enabledOn = (sig: number, signal: 'analog' | 'digital') => {
    const on = spec.muxes.filter((m) => m.signal === signal && m.sigPin === sig && (m.enablePin === undefined || !rp.gpio[m.enablePin]!.outputValue));
    return on.length === 1 ? on[0] : undefined;
  };

  const baseRead = rp.adc.onADCRead;
  rp.adc.onADCRead = (ch) => {
    const sig = 26 + ch;
    const mux = spec.muxes.some((m) => m.signal === 'analog' && m.sigPin === sig) ? enabledOn(sig, 'analog') : undefined;
    const onMux = spec.muxes.some((m) => m.signal === 'analog' && m.sigPin === sig);
    rp.adc.channelValues[ch] = onMux ? (mux ? stim.muxRaw(mux.id, selected(mux)) : 0) : stim.adcRaw(sig);
    baseRead(ch);
  };

  const pins = spec.controls.flatMap((c) => (c.kind === 'button' ? (c.pin !== undefined ? [c.pin] : []) : c.kind === 'encoder' ? [c.pinA!, c.pinB!] : []));
  // Digital mux: the SIG pin shows the enabled mux's selected button, so refresh it whenever S0..S3 / EN change or time advances.
  const digital = spec.muxes.filter((m) => m.signal === 'digital');
  let curMs = 0;
  const refreshMux = () =>
    new Set(digital.map((m) => m.sigPin)).forEach((sig) => {
      const m = enabledOn(sig, 'digital');
      rp.gpio[sig]!.setInputValue(m ? !!stim.muxLevel(m.id, selected(m), curMs) : true);
    });
  if (digital.length)
    new Set(digital.flatMap((m) => [...m.selectPins, ...(m.enablePin !== undefined ? [m.enablePin] : [])])).forEach((p) => rp.gpio[p]!.addListener(refreshMux));
  const apply = (tMs: number) => {
    curMs = tMs;
    pins.forEach((p) => rp.gpio[p]!.setInputValue(!!stim.pinLevel(p, tMs)));
    refreshMux();
  };
  const ledSubs = new Set<(rgb: Uint8Array, t: number) => void>();
  let t0 = 0;
  const port = spec.midiPort;
  if (port && (port.txPin !== undefined || port.rxPin !== undefined)) {
    const p = (port.txPin ?? port.rxPin)!;
    rig.attachPort([0, 1, 12, 13, 16, 17].includes(p) ? 0 : 1);
  }
  if (spec.leds && spec.leds.count > 0 && spec.leds.pin !== undefined)
    rig.watchWs2812(spec.leds.pin, spec.leds.count, (rgb, t) => ledSubs.forEach((cb) => cb(rgb, t - t0 / 1e6)));

  rig.runUntil(BOOT_LIMIT_MS * 1e6, () => rig.usbState === 'configured');
  if (rig.usbState !== 'configured') throw new Error(`firmware did not enumerate within ${BOOT_LIMIT_MS} ms`);
  t0 = rig.rp.clock.nanos;
  let now = 0; // integer ms since boot completed

  return {
    fidelity: 'firmware',
    product: rig.product,
    get usbState() {
      return rig.usbState;
    },
    setAnalog: (id, v) => stim.setAnalog(id, v),
    setButton: (id, p) => stim.setButton(id, p, now),
    turnEncoder: (id, n) => stim.turnEncoder(id, n, now),
    async advance(ms) {
      for (let i = 0; i < ms; i++) {
        apply(now);
        rig.runUntil(t0 + (now + 1) * 1e6);
        now++;
      }
    },
    onMidi: (cb) => rig.onMidi((m, t) => cb(m, t - t0 / 1e6)),
    sendMidi: (msg) => rig.sendMidi(msg),
    sendPortMidi: (bytes) => rig.sendPortBytes(bytes),
    onPortMidi: (cb) => rig.onPortMidi((m, t) => cb(m, t - t0 / 1e6)),
    onLeds(cb) {
      ledSubs.add(cb);
      return () => void ledSubs.delete(cb);
    },
  };
}
