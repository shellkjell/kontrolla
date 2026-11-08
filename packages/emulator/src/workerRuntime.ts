// Real-time pacing and message handling for the worker, free of `self` so it can be unit-tested.
import type { DeviceSpec, SimOptions } from '@kontrolla/core';
import { createRp2040Device, type Rp2040Device } from './device';
import type { UsbState } from './rig';

export type WorkerIn =
  | { type: 'init'; spec: DeviceSpec; firmwareBin: ArrayBuffer; opts?: SimOptions }
  | { type: 'setAnalog'; id: string; value: number }
  | { type: 'setButton'; id: string; pressed: boolean }
  | { type: 'turnEncoder'; id: string; detents: number }
  | { type: 'sendMidi'; msg: number[] }
  | { type: 'sendPortMidi'; bytes: number[] }
  | { type: 'run' }
  | { type: 'pause' };

export type WorkerOut =
  | { type: 'ready'; product: string; usbState: UsbState }
  | { type: 'midi'; events: { msg: number[]; timeMs: number }[] }
  | { type: 'portMidi'; events: { msg: number[]; timeMs: number }[] }
  | { type: 'leds'; rgb: Uint8Array; timeMs: number }
  | { type: 'stats'; simMsPerWallMs: number; lagMs: number }
  | { type: 'error'; message: string };

const CHUNK_MS = 16;
const MAX_BACKLOG_MS = 50; // beyond this, drop time instead of catching up (and count it as lag)
const STATS_EVERY_MS = 1000;

export function createWorkerRuntime(
  post: (m: WorkerOut) => void,
  now: () => number = () => performance.now(),
  yieldToInbox: (f: () => void) => void = (f) => void setTimeout(f, 0),
) {
  let dev: Rp2040Device | undefined;
  let events: { msg: number[]; timeMs: number }[] = [];
  let portEvents: { msg: number[]; timeMs: number }[] = [];
  let ledFrames: { rgb: Uint8Array; timeMs: number }[] = [];
  let running = false;
  let gen = 0;
  let chain: Promise<void> = Promise.resolve();

  async function loop(myGen: number) {
    let last = now();
    let owed = 0;
    let lagMs = 0;
    let statWall = last;
    let statSim = 0;
    while (running && gen === myGen) {
      const t = now();
      owed += t - last;
      last = t;
      if (owed > MAX_BACKLOG_MS) {
        lagMs += owed - MAX_BACKLOG_MS;
        owed = MAX_BACKLOG_MS;
      }
      const n = Math.min(Math.floor(owed), CHUNK_MS);
      if (n > 0) {
        await dev!.advance(n);
        owed -= n;
        statSim += n;
        if (events.length) {
          post({ type: 'midi', events });
          events = [];
        }
        if (portEvents.length) {
          post({ type: 'portMidi', events: portEvents });
          portEvents = [];
        }
        // Only the newest frame matters to a UI; older ones in the same chunk are dropped.
        const f = ledFrames.at(-1);
        if (f) post({ type: 'leds', rgb: f.rgb, timeMs: f.timeMs });
        ledFrames = [];
      }
      const w = now();
      if (w - statWall >= STATS_EVERY_MS) {
        post({ type: 'stats', simMsPerWallMs: statSim / (w - statWall), lagMs });
        statWall = w;
        statSim = 0;
      }
      await new Promise<void>(yieldToInbox);
    }
  }

  const start = () => {
    if (running || !dev) return;
    running = true;
    void loop(++gen).catch((e) => post({ type: 'error', message: String(e) }));
  };

  async function handle(m: WorkerIn) {
    if (m.type === 'init') {
      running = false;
      gen++;
      dev = await createRp2040Device(m.spec, new Uint8Array(m.firmwareBin), m.opts);
      dev.onMidi((msg, timeMs) => events.push({ msg, timeMs }));
      dev.onPortMidi((msg, timeMs) => portEvents.push({ msg, timeMs }));
      dev.onLeds((rgb, timeMs) => ledFrames.push({ rgb, timeMs }));
      post({ type: 'ready', product: dev.product, usbState: dev.usbState }); // client sends 'run' after power-on stimulus
    } else if (!dev) {
      throw new Error(`'${m.type}' before init`);
    } else if (m.type === 'setAnalog') dev.setAnalog(m.id, m.value);
    else if (m.type === 'setButton') dev.setButton(m.id, m.pressed);
    else if (m.type === 'turnEncoder') dev.turnEncoder(m.id, m.detents);
    else if (m.type === 'sendMidi') dev.sendMidi(m.msg);
    else if (m.type === 'sendPortMidi') dev.sendPortMidi(m.bytes);
    else if (m.type === 'run') start();
    else if (m.type === 'pause') running = false;
  }

  /** Messages are handled in order; failures are reported as {type:'error'}. */
  return (m: WorkerIn): Promise<void> =>
    (chain = chain.then(() => handle(m)).catch((e) => post({ type: 'error', message: e instanceof Error ? e.message : String(e) })));
}
