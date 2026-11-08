// RP2040 running the real firmware in rp2040js, plus a USB-MIDI host on its USB peripheral.
// No Node-only APIs: firmware and blob arrive as bytes.
import { bootromB1 } from './bootrom';
import { runPioInSimTime } from './pioClock';
import { ConsoleLogger, createSetupPacket, DataDirection, GPIOPinState, LogLevel, RP2040, SetupRecipient, SetupType, type SimulationClockLike } from './rp2040js';

export type UsbState = 'detached' | 'enumerating' | 'configured';

export const BLOB_FLASH_OFFSET = 0x1f0000;
const NS_PER_CYCLE = 8; // 125 MHz
const EP0_MAX = 64;
const enum Step { Idle, Address, Device, Config, String, Done }
const CIN_LEN: Record<number, number> = { 0x8: 3, 0x9: 3, 0xa: 3, 0xb: 3, 0xc: 2, 0xd: 2, 0xe: 3 };

const ctrl = (dir: DataDirection, bRequest: number, wValue: number, wIndex: number, wLength: number) =>
  createSetupPacket({ dataDirection: dir, type: SetupType.Standard, recipient: SetupRecipient.Device, bRequest, wValue, wIndex, wLength });

/** Bulk endpoint number (IN or OUT) of the first MIDIStreaming interface (class 1, subclass 3), or -1. */
export function findMidiEndpoint(cfg: ArrayLike<number>, dirIn: boolean): number {
  let inMidi = false;
  for (let i = 0; i + 1 < cfg.length && cfg[i]! >= 2; i += cfg[i]!) {
    const type = cfg[i + 1]!;
    if (type === 4) inMidi = cfg[i + 5] === 1 && cfg[i + 6] === 3;
    else if (type === 5 && inMidi && (cfg[i + 3]! & 3) === 2 && !!(cfg[i + 2]! & 0x80) === dirIn) return cfg[i + 2]! & 0xf;
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
  private midiOut = -1;
  private outQueue: number[] = []; // host -> device USB-MIDI event packets (4 bytes each)
  private outWaiting = 0; // bytes the device has asked for on the OUT endpoint (0 = no pending read)
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
    runPioInSimTime(rp);
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
    // Hot loop: one iteration per instruction (or per idle jump to the next alarm).
    while (clock.nanos < targetNs) {
      if (stop?.()) return;
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
        this.midiIn = findMidiEndpoint(this.data, true);
        this.midiOut = findMidiEndpoint(this.data, false);
        this.step = Step.String;
        return this.send(get(0x0300 | this.iProduct, 0x0409, 255), 255);
      case Step.String:
        this.product = utf16(this.data);
        // 'configured' is declared when SET_CONFIGURATION is *issued*, not when its status ZLP comes back: the firmware
        // mounts (and may start its first scan) a few microseconds before the host sees that ZLP, so waiting for the ZLP
        // would let the first scan latch its baseline before the caller could set any stimulus.
        this.step = Step.Done;
        this.usbState = 'configured';
        return this.send(ctrl(DataDirection.HostToDevice, 9, 1, 0, 0));
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
        if (this.step === Step.Address || this.step === Step.Done) {
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
    usb.onEndpointRead = (ep, size) => {
      if (ep !== this.midiOut) return;
      this.outWaiting = size;
      this.pumpOut();
    };
  }

  /** Host -> device MIDI (one channel-voice message), delivered as a USB-MIDI packet on cable 0 when the device reads its OUT endpoint. */
  sendMidi(msg: number[]) {
    if (msg[0] === 0xf0) {
      // SysEx: 3 bytes per packet, CIN 4 for "more follows", 5/6/7 for a final packet of 1/2/3 bytes
      for (let i = 0; i < msg.length; i += 3) {
        const chunk = msg.slice(i, i + 3);
        const last = i + 3 >= msg.length;
        this.outQueue.push(last ? 4 + chunk.length : 4, chunk[0] ?? 0, chunk[1] ?? 0, chunk[2] ?? 0);
      }
      this.pumpOut();
      return;
    }
    const st = msg[0] ?? 0;
    this.outQueue.push(st >> 4, st, msg[1] ?? 0, msg[2] ?? 0);
    this.pumpOut();
  }

  private pumpOut() {
    if (!this.outWaiting || !this.outQueue.length || this.midiOut < 0) return;
    const n = Math.min(this.outQueue.length, this.outWaiting & ~3);
    if (!n) return;
    this.outWaiting = 0;
    this.rp.usbCtrl.endpointReadDone(this.midiOut, Uint8Array.from(this.outQueue.splice(0, n)));
  }

  /**
   * Hardware MIDI port. `uartIndex` is the rp2040js UART the firmware uses (0 or 1). TX bytes are parsed into messages
   * (`onPortMidi`); RX bytes are injected at the 31250 baud byte rate (320 us each) so the 32-byte FIFO never overflows.
   */
  private portSubs = new Set<(msg: number[], timeMs: number) => void>();
  private rxQueue: number[] = [];
  private rxAlarm?: { schedule(ns: number): void };

  attachPort(uartIndex: number) {
    const uart = this.rp.uart[uartIndex]!;
    let status = 0;
    let data: number[] = [];
    uart.onByte = (b) => {
      if (b & 0x80) {
        status = b;
        data = [];
        return;
      }
      if (!status) return;
      data.push(b);
      if (data.length === ((status & 0xe0) === 0xc0 ? 1 : 2)) {
        const msg = [status, ...data];
        data = [];
        const t = this.timeMs;
        this.portSubs.forEach((cb) => cb(msg, t));
      }
    };
    this.rxAlarm = this.rp.clock.createAlarm(() => {
      const b = this.rxQueue.shift();
      if (b !== undefined) uart.feedByte(b);
      if (this.rxQueue.length) this.rxAlarm!.schedule(320_000);
    });
  }

  onPortMidi(cb: (msg: number[], timeMs: number) => void) {
    this.portSubs.add(cb);
    return () => void this.portSubs.delete(cb);
  }

  /** Raw bytes into the device's UART RX. */
  sendPortBytes(bytes: number[]) {
    if (!this.rxAlarm) return;
    const idle = !this.rxQueue.length;
    this.rxQueue.push(...bytes.map((b) => b & 0xff));
    if (idle && this.rxQueue.length) (this.rxAlarm as unknown as { schedule(ns: number): void }).schedule(320_000);
  }

  /**
   * Decodes the real WS2812 waveform on `pin` (pulse widths in simulated time, produced by the firmware's PIO program):
   * a high pulse > 560 ns is a 1, a gap > 30 us ends the frame. `cb` gets GRB-decoded RGB bytes (count*3) per complete frame.
   */
  watchWs2812(pin: number, count: number, cb: (rgb: Uint8Array, timeMs: number) => void) {
    const clock = this.rp.clock;
    let rise = 0;
    let bits: number[] = [];
    const flush = clock.createAlarm(() => {
      const ok = bits.length === count * 24;
      const frame = bits;
      bits = [];
      if (!ok) return;
      const rgb = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) {
        const byte = (o: number) => frame.slice(i * 24 + o, i * 24 + o + 8).reduce((a, b) => (a << 1) | b, 0);
        rgb[i * 3] = byte(8); // R
        rgb[i * 3 + 1] = byte(0); // G
        rgb[i * 3 + 2] = byte(16); // B
      }
      cb(rgb, clock.nanos / 1e6);
    });
    this.rp.gpio[pin]!.addListener((state) => {
      const t = clock.nanos;
      if (state === GPIOPinState.High) rise = t;
      else {
        bits.push(t - rise > 560 ? 1 : 0);
        flush.schedule(30_000);
      }
    });
  }
}
