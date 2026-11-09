import { CHANNEL_DEFAULTS, EQ_BANDS, MASTER_DEFAULTS, SAMPLE_RATE, filterMode, gainDb, highpass, lowpass, magDb, meterCc } from '@kontrolla/audio';
import type { DeviceSpec } from '@kontrolla/core';
import { labelOf } from '../../pins';
import type { Bench } from '../bench';
import { lit, sleep } from '../runner';
import type { Status } from '../runner';
import type { Rig } from './rig';

export interface AudioRow {
  id: string;
  /** Channel, or "Master". */
  group: string;
  check: string;
  status: Status;
  what: string;
  fix?: string;
}
export interface AudioProgress {
  done: number;
  total: number;
  current: string;
}
export interface AudioRunOptions {
  onProgress: (p: AudioProgress) => void;
  onRow: (r: AudioRow) => void;
  aborted: () => boolean;
}

const TONE = { kind: 'demo', id: 'tone1k' } as const;
const SETTLE = 230;
const BASE_DB = -18; // tone1k at the ADC in calibration mode, through unity gain, fader, pan and master
const db1 = (n: number) => (n > -120 ? n.toFixed(1) : '−∞');

/**
 * Feeds a 1 kHz tone at -18 dBFS through each channel and drives the mixer the way a hand would, through the real
 * firmware: every control moves on the virtual panel, goes out of the surface's UART as MIDI, and is judged by what comes out of the engine.
 */
export async function runAudioTest(rig: Rig, bench: Bench, spec: DeviceSpec, opts: AudioRunOptions): Promise<AudioRow[]> {
  const a = spec.audio!;
  const sim = bench.sim;
  const rows: AudioRow[] = [];
  const chans = rig.channels();
  const brightness = spec.leds?.brightness ?? 255;
  const lastStats = () => rig.stats();
  const total = a.channels.length + 1;
  let done = 0;

  const push = (id: string, group: string, check: string, status: Status, what: string, fix?: string) => {
    const r: AudioRow = { id, group, check, status, what, ...(fix && { fix }) };
    rows.push(r);
    opts.onRow(r);
  };
  const ctl = (id: string | undefined) => spec.controls.find((c) => c.id === id);
  const move = (id: string | undefined, x: number) => id && bench.setAnalog(id, x);
  const ledOn = (id: string | undefined) => {
    const c = ctl(id);
    return c?.kind === 'button' && c.led ? lit(bench.frame(), c.led.index, c.led.color, brightness) : null;
  };
  /** Make a toggle button reach the wanted state, judged by its LED (the firmware's own toggle state). */
  const setToggle = async (id: string | undefined, want: boolean) => {
    if (!id) return;
    for (let k = 0; k < 2; k++) {
      const now = ledOn(id);
      if (now === null || now === want) return;
      sim.setButton(id, true);
      await sleep(60);
      sim.setButton(id, false);
      await sleep(90);
    }
  };
  /** Highest instantaneous peak seen at a bus over ~100 ms. */
  const peak = async (bus: 'master' | 'booth' | 'phones'): Promise<[number, number]> => {
    let l = -Infinity, r = -Infinity;
    for (let k = 0; k < 3; k++) {
      const [pl, pr] = rig.busPeak(bus);
      l = Math.max(l, pl);
      r = Math.max(r, pr);
      await sleep(22);
    }
    return [l, r];
  };
  const level = async (bus: 'master' | 'booth' | 'phones' = 'master') => Math.max(...(await peak(bus)));

  // ---- remember everything we are about to disturb ----
  const bound = [...a.channels.flatMap((c) => Object.values(c.bind)), ...Object.values(a.master.bind)].filter((x): x is string => !!x);
  const saved = {
    values: new Map(bound.flatMap((id) => (ctl(id)?.kind === 'button' ? [] : [[id, bench.value(id)] as const]))),
    sources: chans.map((c) => ({ A: c.sources.A, B: c.sources.B })),
    volume: rig.volume(),
    playing: rig.playing(),
  };
  const defaults = (): void => {
    for (const ch of a.channels) for (const [p, id] of Object.entries(ch.bind)) if (ctl(id)?.kind !== 'button') move(id, CHANNEL_DEFAULTS[p as keyof typeof CHANNEL_DEFAULTS] / 127);
    for (const [p, id] of Object.entries(a.master.bind)) move(id, MASTER_DEFAULTS[p as keyof typeof MASTER_DEFAULTS] / 127);
  };

  try {
    rig.setVolume(0); // the test is silent: it measures the engine outputs, not your speakers
    rig.setCalibration(true);
    for (let i = 0; i < chans.length; i++) for (const s of ['A', 'B'] as const) await rig.setSource(i, s, { kind: 'none' });
    for (const ch of a.channels) for (const id of Object.values(ch.bind)) if (ctl(id)?.kind === 'button') await setToggle(id, false);
    for (const id of Object.values(a.master.bind)) if (ctl(id)?.kind === 'button') await setToggle(id, false);
    defaults();
    rig.play();
    await sleep(600);

    const active = (i: number) => (lastStats()?.channels[i] as { active?: boolean } | undefined)?.active !== false;
    const solo = (i: number) => a.channels.findIndex((_, k) => k !== i && active(k));

    for (let i = 0; i < a.channels.length; i++) {
      if (opts.aborted()) break;
      const ch = a.channels[i]!;
      const c = chans[i]!;
      const g = ch.label;
      opts.onProgress({ done, total, current: g });
      if (!active(i)) {
        push(`${ch.id}-codec`, g, 'Codec input', 'fail', 'This channel has no codec input on the selected audio board.', 'Use the two-codec board (unproven), or fewer channels.');
        done++;
        continue;
      }
      const set = c.active;
      await rig.setSource(i, set, TONE);
      await sleep(SETTLE + 200);
      const st = () => lastStats()?.channels[i];

      // 1. the signal path, end to end, including the LEDs the firmware lights from the engine's meter CC
      const base = await level();
      const adc = st()?.adc.peakDb ?? -Infinity;
      const meter = spec.meters?.find((m) => m.id === ch.meter);
      let ledText = '';
      let ledOk = true;
      if (meter) {
        const want = Math.floor((meterCc(st()?.post.peakDb ?? -Infinity) * meter.ledCount + 126) / 127);
        const f = bench.frame();
        let got = 0;
        for (let k = 0; k < meter.ledCount; k++) if (f && (f[(meter.ledStart + k) * 3]! + f[(meter.ledStart + k) * 3 + 1]! + f[(meter.ledStart + k) * 3 + 2]!) > 0) got++;
        ledOk = got > 0 && Math.abs(got - want) <= 2;
        ledText = `, meter LEDs ${got} of ${meter.ledCount} lit (expected about ${want})`;
      }
      const pathOk = Math.abs(adc - BASE_DB) <= 1.5 && Math.abs(base - BASE_DB) <= 2.5 && ledOk;
      push(`${ch.id}-path`, g, 'Signal path', pathOk ? 'pass' : 'fail', `1 kHz tone at −18 dBFS: ${db1(adc)} at the ADC, ${db1(base)} on the master${ledText}.`,
        !pathOk ? (base < -60 ? 'Nothing reached the master. Check the channel isn’t muted, its fader and GAIN are up, and the engine has the strip’s MIDI numbers (the bindings in Design).' : !ledOk ? 'Sound arrives but the meter LEDs don’t follow: check the meter’s MIDI channel and CC against what the engine sends back (Design → the meter).' : `The level is off by ${db1(Math.max(Math.abs(adc - BASE_DB), Math.abs(base - BASE_DB)))} dB: check the module’s gain staging for this input.`) : undefined);
      if (base < -60) {
        done++;
        continue; // nothing else can be judged without signal
      }

      // 2. fader
      const fader = ch.bind.fader;
      if (fader) {
        move(fader, 0);
        await sleep(SETTLE);
        const dead = await level();
        move(fader, CHANNEL_DEFAULTS.fader / 127);
        await sleep(SETTLE);
        const back = await level();
        const ok = dead < -60 && Math.abs(back - base) <= 1.5;
        push(`${ch.id}-fader`, g, 'Fader', ok ? 'pass' : 'fail', `Fader down: ${db1(dead)} dB; back at 0 dB: ${db1(back)} dB (was ${db1(base)}).`, ok ? undefined : 'Fader down should be silence and back up should return to the same level. Check the fader’s MIDI target (Design).');
      }
      // 3. gain
      if (ch.bind.gain) {
        move(ch.bind.gain, 1);
        await sleep(SETTLE);
        const hi = await level();
        move(ch.bind.gain, CHANNEL_DEFAULTS.gain / 127);
        const want = gainDb(127) - gainDb(CHANNEL_DEFAULTS.gain);
        const ok = Math.abs(hi - base - want) <= 2;
        push(`${ch.id}-gain`, g, 'Gain', ok ? 'pass' : 'fail', `GAIN fully up: ${db1(hi - base)} dB (expected ${db1(want)}).`, ok ? undefined : 'GAIN isn’t doing what the curve says. Check its MIDI target.');
        await sleep(SETTLE);
      }
      // 4. mute
      if (ch.bind.mute) {
        await setToggle(ch.bind.mute, true);
        await sleep(SETTLE);
        const m = await level();
        const lamp = ledOn(ch.bind.mute);
        await setToggle(ch.bind.mute, false);
        await sleep(SETTLE);
        const back = await level();
        const ok = m < -70 && Math.abs(back - base) <= 1.5 && lamp !== false;
        push(`${ch.id}-mute`, g, 'Mute', ok ? 'pass' : 'fail', `Muted: ${db1(m)} dB${lamp === null ? '' : lamp ? ', mute LED lit' : ', mute LED dark'}; unmuted: ${db1(back)} dB.`, ok ? undefined : m >= -70 ? 'Mute didn’t silence the master. Check the mute button’s MIDI note against the engine’s binding.' : 'Muting works but something else is off: look at the LED and level.');
      }
      // 5. pan / balance
      if (ch.bind.pan) {
        move(ch.bind.pan, 0);
        await sleep(SETTLE);
        const [l0, r0] = await peak('master');
        move(ch.bind.pan, 1);
        await sleep(SETTLE);
        const [l1, r1] = await peak('master');
        move(ch.bind.pan, CHANNEL_DEFAULTS.pan / 127);
        const ok = r0 < -60 && Math.abs(l0 - base) <= 2 && l1 < -60 && Math.abs(r1 - base) <= 2;
        push(`${ch.id}-pan`, g, 'Pan', ok ? 'pass' : 'fail', `Hard left: L ${db1(l0)} / R ${db1(r0)}. Hard right: L ${db1(l1)} / R ${db1(r1)}.`, ok ? undefined : 'Pan should empty the opposite side completely at the ends. Swap the pot’s outer legs if left and right are reversed.');
        await sleep(SETTLE);
      }
      // 6. EQ kill: the band that bites 1 kHz hardest
      const band = [...EQ_BANDS].map((b) => ({ b, drop: magDb(b.make(-26, SAMPLE_RATE), 1000) })).sort((x, y) => x.drop - y.drop)[0]!;
      const eqId = ch.bind[band.b.param];
      if (eqId) {
        move(eqId, 0);
        await sleep(SETTLE);
        const cut = await level();
        move(eqId, CHANNEL_DEFAULTS[band.b.param] / 127);
        await sleep(SETTLE);
        const back = await level();
        const drop = cut - base;
        const ok = drop <= -3 && Math.abs(drop - band.drop) <= 3 && Math.abs(back - base) <= 1.5;
        push(`${ch.id}-eq`, g, 'EQ kill', ok ? 'pass' : 'fail', `${labelOf(ctl(eqId) ?? { id: eqId })} fully cut: ${db1(drop)} dB at 1 kHz (the curve predicts ${db1(band.drop)}); centred again: ${db1(back - base)} dB.`, ok ? undefined : 'An EQ band cut all the way down should drop 1 kHz by about the predicted amount, and the centre detent should be exactly flat.');
      }
      // 7. filter sweep
      if (ch.bind.filter) {
        const f = ch.bind.filter;
        const pLp = magDb(lowpass((filterMode(0) as { freq: number }).freq, 1), 1000);
        const pHp = magDb(highpass((filterMode(127) as { freq: number }).freq, 1), 1000);
        move(f, 0);
        await sleep(SETTLE);
        const lp = (await level()) - base;
        move(f, 1);
        await sleep(SETTLE);
        const hp = (await level()) - base;
        move(f, CHANNEL_DEFAULTS.filter / 127);
        await sleep(SETTLE);
        const mid = (await level()) - base;
        const ok = Math.abs(lp - pLp) <= 4 && Math.abs(hp - pHp) <= 4 && Math.abs(mid) <= 1;
        push(`${ch.id}-filter`, g, 'Filter', ok ? 'pass' : 'fail', `Fully left (low-pass 150 Hz): ${db1(lp)} dB at 1 kHz; fully right (high-pass 3 kHz): ${db1(hp)} dB; centre: ${db1(mid)} dB (bypass).`, ok ? undefined : 'Left should cut the highs, right the lows, and the centre should leave the sound untouched.');
      }
      // 8. solo-in-place with a partner
      const j = solo(i);
      if (ch.bind.solo && j >= 0) {
        // the sum of two tones depends on their phase, so judge the gate, not the sum: the partner is heard, then not
        await rig.setSource(j, chans[j]!.active, TONE);
        await sleep(SETTLE + 200);
        const partnerBefore = lastStats()?.channels[j]?.audible;
        await setToggle(ch.bind.solo, true);
        await sleep(SETTLE);
        const only = await level();
        const partnerHeard = lastStats()?.channels[j]?.audible;
        await setToggle(ch.bind.solo, false);
        await rig.setSource(j, chans[j]!.active, { kind: 'none' });
        await sleep(SETTLE);
        const ok = partnerBefore === true && partnerHeard === false && Math.abs(only - base) <= 2;
        push(`${ch.id}-solo`, g, 'Solo', ok ? 'pass' : 'fail', `With ${a.channels[j]!.label} also playing, ${g} soloed: master ${db1(only)} dB (${g} alone is ${db1(base)}); ${a.channels[j]!.label} ${partnerHeard === false ? 'gated off' : 'still audible'}.`, ok ? undefined : 'Solo should leave only this channel on the master and gate the others off. Check the solo button’s MIDI note against the engine’s binding.');
      }
      // 9. cue reaches the headphones only
      const phonesId = a.master.bind.phones;
      const mixId = a.master.bind.cueMix;
      if (ch.bind.cue && phonesId && mixId && ch.bind.mute) {
        move(phonesId, 1);
        move(mixId, 0);
        await setToggle(ch.bind.mute, true); // master silent: whatever reaches the phones is the cue
        await sleep(SETTLE);
        const before = await level('phones');
        await setToggle(ch.bind.cue, true);
        await sleep(SETTLE);
        const ph = await level('phones');
        const ma = await level('master');
        const bo = await level('booth');
        await setToggle(ch.bind.cue, false);
        await setToggle(ch.bind.mute, false);
        move(phonesId, MASTER_DEFAULTS.phones / 127);
        move(mixId, MASTER_DEFAULTS.cueMix / 127);
        await sleep(SETTLE);
        const ok = before < -60 && Math.abs(ph - base) <= 2.5 && ma < -70 && bo < -70;
        push(`${ch.id}-cue`, g, 'Cue to phones only', ok ? 'pass' : 'fail', `Muted, CUE off: phones ${db1(before)}. CUE on (cue mix fully on cue): phones ${db1(ph)}, master ${db1(ma)}, booth ${db1(bo)}.`, ok ? undefined : 'CUE should put the channel in the headphones (even muted, before its fader) and nowhere else. Check the cue button’s MIDI note and the CUE MIX / PHONES knobs.');
      }
      // 10. A/B input select, through the strip's own button
      if (ch.bind.inputSelect && c.module.selectable && (c.module.inputs?.length ?? 0) > 1) {
        const other = set === 'A' ? 'B' : 'A';
        await rig.setSource(i, set, { kind: 'none' });
        await rig.setSource(i, other, TONE);
        await sleep(SETTLE);
        const silent = await level();
        await setToggle(ch.bind.inputSelect, other === 'B');
        await sleep(SETTLE + 300);
        const now = chans[i]!.active;
        const heard = await level();
        await setToggle(ch.bind.inputSelect, false);
        await rig.setSource(i, other, { kind: 'none' });
        await rig.setSource(i, set, TONE);
        await sleep(SETTLE);
        const ok = silent < -60 && now === other && Math.abs(heard - BASE_DB) <= 2.5;
        push(`${ch.id}-input`, g, 'A/B input', ok ? 'pass' : 'fail', `Tone on ${other} only: silent on ${set} (${db1(silent)}), after the A/B button the engine reads ${now} and the master hears ${db1(heard)} dB.`, ok ? undefined : 'The A/B button should switch which connector set feeds the channel. Check its MIDI note and that the module has two inputs.');
      }
      await rig.setSource(i, set, { kind: 'none' });
      done++;
    }

    // ---- master section ----
    if (!opts.aborted()) {
      opts.onProgress({ done, total, current: 'Master' });
      const i0 = a.channels.findIndex((_, k) => active(k));
      if (i0 >= 0) {
        await rig.setSource(i0, chans[i0]!.active, TONE);
        await sleep(SETTLE + 300);
        const base = await level();
        const mf = a.master.bind.master;
        if (mf) {
          move(mf, 0);
          await sleep(SETTLE);
          const m = await level('master');
          const b = await level('booth');
          move(mf, MASTER_DEFAULTS.master / 127);
          await sleep(SETTLE);
          const ok = m < -60 && b < -60;
          push('master-fader', 'Master', 'Master fader', ok ? 'pass' : 'fail', `Master fader down: master ${db1(m)} dB, booth ${db1(b)} dB (it feeds both).`, ok ? undefined : 'The master fader should silence the master and the booth. Check its MIDI target.');
        }
        const bo = a.master.bind.booth;
        if (bo) {
          move(bo, 0);
          await sleep(SETTLE);
          const b = await level('booth');
          const m = await level('master');
          move(bo, MASTER_DEFAULTS.booth / 127);
          await sleep(SETTLE);
          const ok = b < -60 && Math.abs(m - base) <= 1.5;
          push('master-booth', 'Master', 'Booth level', ok ? 'pass' : 'fail', `BOOTH down: booth ${db1(b)} dB, master still ${db1(m)} dB.`, ok ? undefined : 'BOOTH should only change the booth output.');
        }
        for (const [side, mid] of Object.entries(a.master.meters ?? {})) {
          const m = spec.meters?.find((x) => x.id === mid);
          if (!m) continue;
          const f = bench.frame();
          let got = 0;
          for (let k = 0; k < m.ledCount; k++) if (f && (f[(m.ledStart + k) * 3]! + f[(m.ledStart + k) * 3 + 1]! + f[(m.ledStart + k) * 3 + 2]!) > 0) got++;
          const ok = got > 0;
          push(`master-meter-${side}`, 'Master', `Master meter ${side}`, ok ? 'pass' : 'fail', `${got} of ${m.ledCount} LEDs lit with the tone on the master.`, ok ? undefined : 'The master meter doesn’t light: check the meter’s MIDI channel and CC against the engine’s master meter binding.');
        }
        await rig.setSource(i0, chans[i0]!.active, { kind: 'none' });
      }
      done++;
    }
  } finally {
    // put everything back the way the player had it
    for (const ch of a.channels) for (const id of Object.values(ch.bind)) if (ctl(id)?.kind === 'button') await setToggle(id, false);
    for (const [id, x] of saved.values) move(id, x);
    rig.setCalibration(false);
    for (let i = 0; i < chans.length; i++) for (const s of ['A', 'B'] as const) await rig.setSource(i, s, saved.sources[i]![s]).catch(() => {});
    rig.setVolume(saved.volume);
    if (!saved.playing) rig.stop();
    opts.onProgress({ done, total, current: '' });
  }
  return rows;
}
