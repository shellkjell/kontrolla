// RP2040 running the real firmware in rp2040js, plus a USB-MIDI host on its USB peripheral.
// No Node-only APIs: firmware and blob arrive as bytes.
import { bootromB1 } from './bootrom';
import { ConsoleLogger, createSetupPacket, DataDirection, LogLevel, RP2040, SetupRecipient, SetupType, type SimulationClockLike } from './rp2040js';

export type UsbState = 'detached' | 'enumerating' | 'configured';

export const BLOB_FLASH_OFFSET = 0x1f0000;
const NS_PER_CYCLE = 8; // 125 MHz
const EP0_MAX = 64;
const enum Step { Idle, Address, Device, Config, String, SetConfig, Done }
const CIN_LEN: Record<number, number> = { 0x8: 3, 0x9: 3, 0xa: 3, 0xb: 3, 0xc: 2, 0xd: 2, 0xe: 3 };

const ctrl = (dir: DataDirection, bRequest: number, wValue: number, wIndex: number, wLength: number) =>
  createSetupPacket({ dataDirection: dir, type: SetupType.Standard, recipient: SetupRecipient.Device, bRequest, wValue, wIndex, wLength });

/** Bulk IN endpoint number of the first MIDIStreaming interface (class 1, subclass 3), or -1. */
export function findMidiIn(cfg: ArrayLike<number>): number {
  let inMidi = false;
  for (let i = 0; i + 1 < cfg.length && cfg[i]! >= 2; i += cfg[i]!) {
    const type = cfg[i + 1]!;
    if (type === 4) inMidi = cfg[i + 5] === 1 && cfg[i + 6] === 3;
    else if (type === 5 && inMidi && (cfg[i + 3]! & 3) === 2 && cfg[i + 2]! & 0x80) return cfg[i + 2]! & 0xf;
  }
  return -1;
}

const utf16 = (d: number[]) => {
  let s = '';
  for (let i = 2; i + 1 < d.length; i += 2) s += String.fromCharCode(d[i]! | (d[i + 1]! << 8));
  return s;
};

export class Rp2040Rig {
  readonly rp = new RP2040();
  usbState: UsbState = 'detached';
  product = '';
  private midiIn = -1;
  private step: Step = Step.Idle;
  private data: number[] = [];
  private wLength = 0;
  private iProduct = 0;
  private subs = new Set<(msg: number[], timeMs: number) => void>();

  constructor(firmware: Uint8Array, blob: Uint8Array) {
    const { rp } = this;
    rp.logger = new ConsoleLogger(LogLevel.Error, false); // Debug logging dominates runtime
    rp.loadBootrom(bootromB1); // also resets, which wipes flash: load flash after
    rp.flash.set(firmware, 0);
    rp.flash.set(blob, BLOB_FLASH_OFFSET);
    for (const pin of rp.gpio) pin.setInputValue(true); // idle level with pull-ups; pressed = low
    this.attachHost();
    rp.core.PC = 0x10000000; // start at boot2 in flash; rp2040js models core 0 only, so skip the bootrom's core-select path
  }

  get timeMs() {
    return this.rp.clock.nanos / 1e6;
  }

  onMidi(cb: (msg: number[], timeMs: number) => void) {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  /** Run for `ms` of simulated time. */
  run(ms: number) {
    this.runUntil(this.rp.clock.nanos + ms * 1e6);
  }

  /** Run to an absolute simulated time in ns. `stop` is polled after every instruction. */
  runUntil(targetNs: number, stop?: () => boolean) {
    const { core } = this.rp;
    const clock = this.rp.clock as unknown as SimulationClockLike;
    while (clock.nanos < targetNs && !stop?.()) {
      if (core.waiting) {
        const n = clock.nanosToNextAlarm;
        clock.tick(n > 0 ? Math.min(n, targetNs - clock.nanos) : targetNs - clock.nanos);
      } else {
        clock.tick(core.executeInstruction() * NS_PER_CYCLE);
      }
    }
  }

  private send(setup: Uint8Array, wLength = 0) {
    this.data = [];
    this.wLength = wLength;
    this.rp.usbCtrl.sendSetupPacket(setup);
  }

  private next() {
    const get = (wValue: number, wIndex: number, len: number) => ctrl(DataDirection.DeviceToHost, 6, wValue, wIndex, len);
    switch (this.step) {
      case Step.Idle:
        this.step = Step.Address;
        return this.send(ctrl(DataDirection.HostToDevice, 5, 1, 0, 0));
      case Step.Address:
        this.step = Step.Device;
        return this.send(get(0x0100, 0, 18), 18);
      case Step.Device:
        this.iProduct = this.data[15] ?? 0;
        this.step = Step.Config;
        return this.send(get(0x0200, 0, 255), 255);
      case Step.Config:
        this.midiIn = findMidiIn(this.data);
        this.step = Step.String;
        return this.send(get(0x0300 | this.iProduct, 0x0409, 255), 255);
      case Step.String:
        this.product = utf16(this.data);
        this.step = Step.SetConfig;
        return this.send(ctrl(DataDirection.HostToDevice, 9, 1, 0, 0));
      case Step.SetConfig:
        this.step = Step.Done;
        this.usbState = 'configured';
    }
  }

  private attachHost() {
    const usb = this.rp.usbCtrl;
    usb.onUSBEnabled = () => {
      this.usbState = 'enumerating';
      usb.resetDevice();
    };
    usb.onResetReceived = () => this.next();
    usb.onEndpointWrite = (ep, buf) => {
      if (ep === 0) {
        if (this.step === Step.Address || this.step === Step.SetConfig) {
          if (buf.length === 0) this.next(); // status ZLP
          return;
        }
        this.data.push(...buf);
        // data stage ends on a short packet or when wLength is reached
        if (buf.length < EP0_MAX || this.data.length >= this.wLength) this.next();
      } else if (ep === this.midiIn) {
        const t = this.timeMs;
        for (let i = 0; i + 3 < buf.length; i += 4) {
          const n = (buf[i]! >> 4) === 0 ? CIN_LEN[buf[i]! & 0xf] : undefined; // cable 0 only
          if (n) {
            const msg = Array.from(buf.subarray(i + 1, i + 1 + n));
            this.subs.forEach((cb) => cb(msg, t));
          }
        }
      }
    };
    usb.onEndpointRead = () => {};
  }
}
