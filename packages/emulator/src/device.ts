// DeviceSim backed by the real RP2040 firmware (rp2040js). Stimulus comes from core's shared physics layer.
import { encodeConfig, Stimulus } from '@kontrolla/core';
import type { DeviceSim, DeviceSpec, SimOptions } from '@kontrolla/core';
import { Rp2040Rig, type UsbState } from './rig';

export type Rp2040Device = DeviceSim & { readonly product: string; readonly usbState: UsbState };

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

  // ADC: present the (noisy) physical value; behind a mux, pick the channel the firmware selected on S0..S3.
  const baseRead = rp.adc.onADCRead;
  rp.adc.onADCRead = (ch) => {
    const sig = 26 + ch;
    const mux = spec.muxes.find((m) => m.sigPin === sig);
    const sel = mux?.selectPins.reduce((a, p, i) => a | (rp.gpio[p]!.outputValue ? 1 << i : 0), 0);
    rp.adc.channelValues[ch] = stim.adcRaw(sig, sel);
    baseRead(ch);
  };

  const pins = spec.controls.flatMap((c) => (c.kind === 'button' ? (c.pin !== undefined ? [c.pin] : []) : c.kind === 'encoder' ? [c.pinA!, c.pinB!] : []));
  // Digital mux: the SIG pin shows the selected channel's button, so refresh it whenever S0..S3 change or time advances.
  const digital = spec.muxes.filter((m) => m.signal === 'digital');
  let curMs = 0;
  const refreshMux = () =>
    digital.forEach((m) => {
      const ch = m.selectPins.reduce((a, p, i) => a | (rp.gpio[p]!.outputValue ? 1 << i : 0), 0);
      rp.gpio[m.sigPin]!.setInputValue(!!stim.digitalMuxLevel(m.sigPin, ch, curMs));
    });
  if (digital.length) new Set(digital.flatMap((m) => m.selectPins)).forEach((p) => rp.gpio[p]!.addListener(refreshMux));
  const apply = (tMs: number) => {
    curMs = tMs;
    pins.forEach((p) => rp.gpio[p]!.setInputValue(!!stim.pinLevel(p, tMs)));
    refreshMux();
  };
  const ledSubs = new Set<(rgb: Uint8Array, t: number) => void>();
  let t0 = 0;
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
    onLeds(cb) {
      ledSubs.add(cb);
      return () => void ledSubs.delete(cb);
    },
  };
}
