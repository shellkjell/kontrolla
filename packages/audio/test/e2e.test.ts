// The product's core promise, end to end: surface ⇄ engine over the UART MIDI port, with the behavioural model AND the real firmware.
//   audio → engine meters → UART → firmware → WS2812 LEDs      and      knobs/buttons → UART → engine → audio
// Time is co-simulated: 3 ms of device time per 128-sample audio block (2.9 ms).
import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { allocatePins, createModelDevice, EXAMPLES, type DeviceSim, type DeviceSpec } from '@kontrolla/core';
import { createRp2040Device } from '@kontrolla/emulator';
import { BLOCK, createMixerEngine, faderDb, meterCc, renderSource } from '../src';

const firmware = new Uint8Array(readFileSync(new URL('../../../firmware/rp2040/dist/kontrolla-rp2040.bin', import.meta.url)));
const spec: DeviceSpec = allocatePins(EXAMPLES['mixer-6ch']!);
const meter = (id: string) => spec.meters!.find((m) => m.id === id)!;
const led = (id: string) => (spec.controls.find((c) => c.id === id) as { led: { index: number } }).led.index;
const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const lit = (cc: number, count: number) => Math.floor((cc * count + 126) / 127); // CONTRACTS §2.1

// Where each control sits at power-on (CC units). Chosen away from the engine defaults so the boot snapshot is observable.
const START: Record<string, number> = {
  'ch1-fader': 100, 'ch2-fader': 90, 'ch1-gain': 110, 'master-fader': 100, booth: 127, phones: 127, 'cue-mix': 0, 'fx-return': 0,
};
function startCc(c: { id: string; kind: string }): number {
  if (c.id in START) return START[c.id]!;
  if (/-fx$/.test(c.id)) return 0; // no reverb in these measurements
  if (/-fader$/.test(c.id)) return 0;
  if (/-gain$/.test(c.id)) return 106;
  return 64; // EQ, filter, pan: centre
}

async function rig(kind: 'model' | 'firmware') {
  const sim: DeviceSim = kind === 'model' ? createModelDevice(spec) : await createRp2040Device(spec, firmware);
  const analog = spec.controls.filter((c) => c.kind === 'pot' || c.kind === 'fader');
  const move = (id: string, cc: number) => sim.setAnalog(id, cc / 127);
  analog.forEach((c) => move(c.id, startCc(c)));

  const engine = createMixerEngine(spec);
  let frame = new Uint8Array(spec.leds!.count * 3);
  sim.onLeds((rgb) => (frame = rgb.slice()));
  const toEngine: number[][] = [];
  sim.onPortMidi!((m) => (toEngine.push(m), engine.handleMidi(m)));
  engine.onMidiOut((m) => sim.sendPortMidi!(m)); // first message: the snapshot request, delivered before the first scan

  const drums = renderSource('drums');
  const tone = renderSource('tone1k', 44100, 1);
  let pos = 0;
  const win = { master: 0, phones: 0, lit1: 0, lit2: 0, rms: 0 };
  const out = { master: [new Float32Array(BLOCK), new Float32Array(BLOCK)], booth: [new Float32Array(BLOCK), new Float32Array(BLOCK)], phones: [new Float32Array(BLOCK), new Float32Array(BLOCK)] } as Parameters<typeof engine.process>[1];
  const litOf = (id: string) => {
    const m = meter(id);
    let n = 0;
    for (let i = 0; i < m.ledCount; i++) if (frame[(m.ledStart + i) * 3]! + frame[(m.ledStart + i) * 3 + 1]! + frame[(m.ledStart + i) * 3 + 2]! > 0) n++;
    return n;
  };
  const ledOn = (index: number) => frame[index * 3]! + frame[index * 3 + 1]! + frame[index * 3 + 2]! > 0;

  /** Run `ms` of device time; the window stats cover only this call. */
  async function run(ms: number, feed = true) {
    Object.assign(win, { master: 0, phones: 0, lit1: 0, lit2: 0, rms: 0 });
    let ss = 0, ns = 0;
    for (let t = 0; t < ms; t += 3) {
      await sim.advance(3);
      const a = (src: [Float32Array, Float32Array]) => src.map((ch) => Float32Array.from({ length: BLOCK }, (_, i) => ch[(pos + i) % ch.length]!));
      engine.process(feed ? [a(drums), a(tone)] : [], out);
      pos += BLOCK;
      for (const k of ['master', 'phones'] as const) win[k] = Math.max(win[k], ...out[k][0], ...out[k][1]);
      for (const v of out.master[0]) (ss += v * v, ns++);
      win.lit1 = Math.max(win.lit1, litOf('ch1-meter'));
      win.lit2 = Math.max(win.lit2, litOf('ch2-meter'));
    }
    win.rms = Math.sqrt(ss / Math.max(1, ns));
    return { ...win };
  }
  const press = async (id: string) => {
    sim.setButton(id, true);
    await run(30);
    sim.setButton(id, false);
    await run(30);
  };
  /** Move a control, let it settle, then measure a window. */
  const measure = async (settle = 450, ms = 700) => (await run(settle), run(ms));
  return { sim, engine, move, run, press, measure, toEngine, litOf, ledOn };
}

async function scenario(kind: 'model' | 'firmware') {
  const r = await rig(kind);
  const { engine, move, press, measure, run } = r;
  const n: Record<string, number> = {};
  const log = (k: string, v: number) => (n[k] = Math.round(v * 100) / 100);

  // ---- boot snapshot: the engine asked, the surface answered with where every control actually is ----
  await run(150);
  expect(engine.getParam(0, 'fader')).toBe(100);
  expect(engine.getParam(1, 'fader')).toBe(90);
  expect(engine.getParam(0, 'gain')).toBe(110); // engine default is 106
  expect(engine.getMasterParam('phones')).toBe(127); // default 90
  expect(engine.getMasterParam('cueMix')).toBe(0); // default 64
  expect(engine.getParam(0, 'eqLo')).toBe(64);
  expect(r.toEngine.length).toBeGreaterThanOrEqual(59 + 24); // 59 analog + 24 toggle states (CONTRACTS §2.5)
  log('snapshotMsgs', r.toEngine.length);

  // ---- baseline: drums into ch1, 1 kHz −18 dBFS tone into ch2 (both through the combo module's A input: 12 dB pad) ----
  const base = await measure();
  log('baseMasterDb', dB(base.master));
  log('baseMasterRmsDb', dB(base.rms));
  expect(base.master).toBeGreaterThan(0.05);
  expect(base.lit1).toBeGreaterThanOrEqual(5);
  expect(base.phones).toBe(0); // cue mix = cue only, nothing cued

  // ---- ch1 fader: audio and meter fall to nothing, then come back ----
  move('ch1-fader', 0);
  const faderDown = await measure(900, 300);
  log('faderDownMasterDb', dB(faderDown.master));
  expect(engine.getParam(0, 'fader')).toBeLessThanOrEqual(1);
  expect(dB(faderDown.master)).toBeLessThan(dB(base.master) - 15); // only the −30 dBFS tone is left
  expect(faderDown.lit1).toBe(0);
  move('ch1-fader', 100);
  const faderUp = await measure();
  expect(Math.abs(dB(faderUp.master) - dB(base.master))).toBeLessThan(1);
  expect(faderUp.lit1).toBeGreaterThanOrEqual(base.lit1 - 1);

  // ---- ch1 EQ low kill and filters ----
  move('ch1-lo', 0);
  const lo = await measure();
  log('loKillRmsDeltaDb', dB(lo.rms) - dB(base.rms));
  expect(engine.getParam(0, 'eqLo')).toBe(0);
  expect(dB(lo.rms)).toBeLessThan(dB(base.rms) - 6); // the kick's body lives below 80 Hz
  expect(lo.lit1).toBeLessThanOrEqual(base.lit1); // meter is peak-based; the kick peak is its 150 Hz attack
  move('ch1-lo', 64);
  move('ch1-filter', 127); // high-pass 3 kHz: the kick goes, hats stay
  const hp = await measure();
  log('hp3kRmsDeltaDb', dB(hp.rms) - dB(base.rms));
  expect(dB(hp.rms)).toBeLessThan(dB(base.rms) - 6);
  expect(hp.lit1).toBeLessThanOrEqual(base.lit1);
  move('ch1-filter', 0); // low-pass 150 Hz: kick stays, hats go
  const lp = await measure();
  log('lp150DeltaDb', dB(lp.master) - dB(base.master));
  expect(Math.abs(dB(lp.master) - dB(base.master))).toBeLessThan(4);
  move('ch1-filter', 64);
  const flat = await measure();
  expect(Math.abs(dB(flat.master) - dB(base.master))).toBeLessThan(1);

  // ---- mute: master loses ch1, the post-fader meter keeps showing it, the button LED shows the toggle ----
  expect(r.ledOn(led('ch1-mute'))).toBe(false);
  await press('ch1-mute');
  const muted = await measure(300, 700);
  log('mutedDeltaDb', dB(muted.master) - dB(base.master));
  expect(engine.getParam(0, 'mute')).toBe(127);
  expect(dB(muted.master)).toBeLessThan(dB(base.master) - 15);
  expect(muted.lit1).toBeGreaterThanOrEqual(base.lit1 - 1);
  expect(r.ledOn(led('ch1-mute'))).toBe(true);
  await press('ch1-mute');
  expect(engine.getParam(0, 'mute')).toBe(0);
  expect(r.ledOn(led('ch1-mute'))).toBe(false);
  expect(Math.abs(dB((await measure(300, 700)).master) - dB(base.master))).toBeLessThan(1);

  // ---- cue (PFL) into the phones: independent of fader and of the master ----
  const toneDbfs = -18 - 12; // −18 dBFS tone behind the combo's 12 dB pad
  await press('ch2-cue');
  const cue2 = await measure(300, 700);
  log('cue2PhonesDb', dB(cue2.phones));
  expect(Math.abs(dB(cue2.phones) - toneDbfs)).toBeLessThan(1);
  await press('ch1-cue');
  const cue12 = await measure(300, 700);
  expect(dB(cue12.phones)).toBeGreaterThan(dB(cue2.phones) + 6); // drums are in
  move('ch1-fader', 0);
  const cueFaderDown = await measure(900, 700);
  log('cuePfl.faderDownPhonesDb', dB(cueFaderDown.phones));
  expect(Math.abs(dB(cueFaderDown.phones) - dB(cue12.phones))).toBeLessThan(1); // PFL: the fader does not touch it
  expect(cueFaderDown.lit1).toBe(0);
  move('ch1-fader', 100);
  await press('ch1-cue');
  await press('ch2-cue');
  expect((await measure(300, 700)).phones).toBe(0);

  // ---- solo-in-place: the master carries only ch2; ch2's meter is the exact CC → LED transport ----
  await press('ch2-solo');
  const solo = await measure(450, 700);
  const expectDb = toneDbfs + faderDb(90);
  log('soloMasterDb', dB(solo.master));
  expect(engine.getStats().anySolo).toBe(true);
  expect(Math.abs(dB(solo.master) - expectDb)).toBeLessThan(1);
  expect(solo.lit1).toBeGreaterThanOrEqual(base.lit1 - 1); // ch1's own meter still shows its audio
  expect(r.ledOn(led('ch2-solo'))).toBe(true);
  const st = engine.getStats().channels[1]!;
  expect(Math.abs(st.post.peakDb - expectDb)).toBeLessThan(1);
  expect(r.litOf('ch2-meter')).toBe(lit(st.meterCc, meter('ch2-meter').ledCount)); // steady tone ⇒ frame == last CC sent
  log('ch2MeterCc', st.meterCc);
  log('ch2MeterLit', r.litOf('ch2-meter'));
  expect(st.meterCc).toBe(meterCc(st.post.peakDb));
  await press('ch2-solo');
  expect(Math.abs(dB((await measure(300, 700)).master) - dB(base.master))).toBeLessThan(1);
  return n;
}

for (const kind of ['model', 'firmware'] as const) {
  test(`surface ⇄ engine over the UART MIDI port (${kind})`, async () => {
    const t = performance.now();
    const n = await scenario(kind);
    console.log(`e2e ${kind}: ${((performance.now() - t) / 1000).toFixed(1)} s wall`, JSON.stringify(n));
  }, 120_000);
}
