import { describe, expect, test } from 'bun:test';
import type { AnalogControl, ButtonControl, DeviceSpec } from '@kontrolla/core';
import {
  BLOCK, SAMPLE_RATE, createMixerEngine, cueMixGains, eqDb, faderDb, filterMode, gainDb, gainStaging, generateEngineSketch, highShelf,
  levelDb, lowShelf, magDb, meterCc, panBalance, panMono, peaking, renderSource, Reverb, SOURCES, type EngineOutputs, type MixerEngine,
  type SourceId,
} from '../src';

const pot = (id: string, cc: number, min = 0, max = 127): AnalogControl => ({
  id, kind: 'fader', part: 'fader-60mm', midi: { type: 'cc', channel: 1, cc, min, max }, deadband: 0, smoothing: 0,
});
const note = (id: string, n: number): ButtonControl => ({
  id, kind: 'button', part: 'button-led-12mm', midi: { type: 'note', channel: 1, note: n, velocity: 100 }, mode: 'toggle', debounceMs: 5,
});

const spec: DeviceSpec = {
  version: 1, name: 't', mcu: 'rp2040-pico', usbProductName: 'T', muxes: [],
  controls: [
    pot('f1', 20), pot('pan1', 21), pot('lo1', 22), pot('lm1', 23), pot('hm1', 24), pot('hi1', 25), pot('flt1', 26), pot('gain1', 27), pot('send1', 28),
    note('mute1', 10), note('solo1', 11), note('cue1', 12),
    { ...note('sel1', 0), midi: { type: 'cc', channel: 1, cc: 29, min: 0, max: 127 } },
    pot('f2', 60, 0, 100), note('mute2', 30), note('solo2', 31), note('cue2', 32),
    pot('master', 90), pot('cuemix', 91), pot('phones', 92),
  ],
  meters: [
    { id: 'm1', part: 'meter-led-bar', ledStart: 0, ledCount: 8, midi: { channel: 1, cc: 100 } },
    { id: 'm2', part: 'meter-led-bar', ledStart: 8, ledCount: 8, midi: { channel: 2, cc: 101 } },
    { id: 'mL', part: 'meter-led-bar', ledStart: 16, ledCount: 8, midi: { channel: 1, cc: 102 } },
    { id: 'mR', part: 'meter-led-bar', ledStart: 24, ledCount: 8, midi: { channel: 1, cc: 103 } },
  ],
  ioSlots: [{ id: 's1', module: 'io-dual-trs' }, { id: 's2', module: 'io-xlr' }],
  audio: {
    board: 'teensy41-cs42448x2',
    channels: [
      {
        id: 'ch1', label: '1', slot: 's1', stereo: true, meter: 'm1',
        bind: {
          fader: 'f1', pan: 'pan1', eqLo: 'lo1', eqLoMid: 'lm1', eqHiMid: 'hm1', eqHi: 'hi1', filter: 'flt1', gain: 'gain1', fxSend: 'send1',
          mute: 'mute1', solo: 'solo1', cue: 'cue1', inputSelect: 'sel1',
        },
      },
      { id: 'ch2', label: '2', slot: 's2', stereo: false, meter: 'm2', bind: { fader: 'f2', mute: 'mute2', solo: 'solo2', cue: 'cue2' } },
    ],
    master: { bind: { master: 'master', cueMix: 'cuemix', phones: 'phones' }, meters: { left: 'mL', right: 'mR' }, outputs: [] },
  },
};

const mkOut = (): EngineOutputs => ({
  master: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
  booth: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
  phones: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
});
const dc = (v: number) => new Float32Array(BLOCK).fill(v);
const sine = (f: number, amp: number, off = 0) => Float32Array.from({ length: BLOCK }, (_, i) => amp * Math.sin((2 * Math.PI * f * (i + off)) / SAMPLE_RATE));

/** Run `blocks` blocks of `inputs` (fn of block index) and return the last outputs. */
function run(e: MixerEngine, inputs: (b: number) => Float32Array[][], blocks = 3): EngineOutputs {
  const out = mkOut();
  for (let b = 0; b < blocks; b++) e.process(inputs(b), out);
  return out;
}
const lin = (db: number) => 10 ** (db / 20);
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('curves', () => {
  test('gain / fader / level endpoints', () => {
    expect(gainDb(0)).toBe(-Infinity);
    expect(gainDb(1)).toBe(-60);
    expect(gainDb(106)).toBe(0);
    expect(gainDb(127)).toBe(12);
    expect(faderDb(0)).toBe(-Infinity);
    expect(faderDb(1)).toBe(-60);
    expect(faderDb(100)).toBe(0);
    expect(faderDb(127)).toBe(6);
    expect(levelDb(0)).toBe(-Infinity);
    expect(levelDb(127)).toBe(0);
    expect(levelDb(1)).toBe(-60);
  });
  test('EQ cc map, deadzone exactly 0', () => {
    expect(eqDb(0)).toBe(-26);
    expect(eqDb(127)).toBe(6);
    for (let cc = 62; cc <= 66; cc++) expect(eqDb(cc)).toBe(0);
    expect(eqDb(61)).toBeLessThan(0);
    expect(eqDb(67)).toBeGreaterThan(0);
  });
  test('filter map', () => {
    expect(filterMode(64)).toEqual({ mode: 'off' });
    expect(filterMode(0)).toEqual({ mode: 'lp', freq: 150 });
    expect((filterMode(61) as { freq: number }).freq).toBeCloseTo(20000, 3);
    expect((filterMode(67) as { freq: number }).freq).toBeCloseTo(20, 6);
    expect((filterMode(127) as { freq: number }).freq).toBeCloseTo(3000, 3);
  });
  test('biquad EQ responses', () => {
    expect(magDb(peaking(400, 6, 0.7), 400)).toBeCloseTo(6, 1);
    expect(magDb(peaking(2500, -26, 0.7), 2500)).toBeCloseTo(-26, 1);
    expect(Math.abs(magDb(peaking(2500, 6, 0.7), 2500) - 6)).toBeLessThan(0.5);
    expect(Math.abs(magDb(lowShelf(80, 6), 20) - 6)).toBeLessThan(0.5);
    expect(Math.abs(magDb(lowShelf(80, -26), 20) + 26)).toBeLessThan(0.5);
    expect(Math.abs(magDb(highShelf(8000, 6), 18000) - 6)).toBeLessThan(0.5);
    expect(Math.abs(magDb(highShelf(8000, -26), 18000) + 26)).toBeLessThan(1);
    expect(magDb(lowShelf(80, 6), 80)).toBeCloseTo(3, 0); // shelf midpoint
    expect(Math.abs(magDb(peaking(400, 6, 0.7), 20))).toBeLessThan(0.5); // far from the band: flat
  });
  test('constant-power pan law', () => {
    for (let cc = 0; cc <= 127; cc++) {
      const [l, r] = panMono(cc);
      expect(l * l + r * r).toBeCloseTo(1, 12);
    }
    expect(panMono(64)[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(panMono(1)).toEqual([1, 0]);
    expect(panMono(127)[0]).toBeCloseTo(0, 12);
    expect(panBalance(64)).toEqual([1, 1]);
    expect(panBalance(1)[1]).toBeCloseTo(0, 12);
    expect(panBalance(1)[0]).toBe(1);
    expect(panBalance(127)[1]).toBe(1);
    expect(cueMixGains(0)).toEqual([1, 0]);
    expect(cueMixGains(127)[0]).toBeCloseTo(0, 12);
  });
  test('meter cc map', () => {
    expect(meterCc(-48)).toBe(0);
    expect(meterCc(-100)).toBe(0);
    expect(meterCc(-Infinity)).toBe(0);
    expect(meterCc(0)).toBe(127);
    expect(meterCc(6)).toBe(127);
    expect(meterCc(-24)).toBe(64);
  });
});

describe('engine', () => {
  const stereoIn = (v: number) => [[dc(v), dc(v)], [dc(0), dc(0)]];

  test('defaults are bit-transparent for a stereo channel', () => {
    const e = createMixerEngine(spec);
    const x = sine(1000, 0.3);
    const out = run(e, () => [[x, x]], 4);
    expect(Array.from(out.master[0])).toEqual(Array.from(x));
    expect(Array.from(out.master[1])).toEqual(Array.from(x));
  });
  test('EQ deadzone 62..66 and filter bypass are bit-transparent; engaged filter is not', () => {
    const x = sine(1000, 0.3);
    const ref = Array.from(run(createMixerEngine(spec), () => [[x, x]], 2).master[0]);
    for (const cc of [62, 63, 64, 65, 66]) {
      const e = createMixerEngine(spec);
      for (const p of ['eqLo', 'eqLoMid', 'eqHiMid', 'eqHi', 'filter'] as const) e.setParam(0, p, cc);
      expect(Array.from(run(e, () => [[x, x]], 2).master[0])).toEqual(ref);
    }
    const e = createMixerEngine(spec);
    e.setParam(0, 'filter', 10); // low-pass ≈ 200 Hz: kills 1 kHz
    expect(rms(run(e, () => [[sine(1000, 0.3, 0), sine(1000, 0.3, 0)]], 20).master[0])).toBeLessThan(0.3 * Math.SQRT1_2 * 0.2);
  });
  test('EQ kill / boost through the engine', () => {
    const level = (cc: number, f: number) => {
      const e = createMixerEngine(spec);
      e.setParam(0, 'eqLoMid', cc);
      let o = mkOut(), s = sine(f, 0.1);
      for (let b = 0; b < 40; b++) { s = sine(f, 0.1, b * BLOCK); o = run(e, () => [[s, s]], 1); }
      return 20 * Math.log10(rms(o.master[0]) / rms(s)); // same block → partial cycles cancel
    };
    expect(level(0, 400)).toBeCloseTo(-26, 0);
    expect(level(127, 400)).toBeCloseTo(6, 0);
    expect(level(64, 400)).toBeCloseTo(0, 6);
  });
  test('fader 0 is silent; fader curve in the signal path', () => {
    const e = createMixerEngine(spec);
    e.setParam(0, 'fader', 0);
    expect(run(e, () => stereoIn(0.5), 3).master[0].every((v) => v === 0)).toBe(true);
    e.setParam(0, 'fader', 127);
    expect(run(e, () => stereoIn(0.1), 3).master[0][5]).toBeCloseTo(0.1 * lin(6), 5);
  });
  test('solo-in-place, mute wins', () => {
    const e = createMixerEngine(spec);
    const inp = () => [[dc(0.1), dc(0.1)], [dc(0.2), dc(0.2)]];
    const lvl = () => run(e, inp, 3).master[0][0]!;
    // ch2 is mono dual-mono, pan centre = −3 dB per side
    const c1 = 0.1, c2 = 0.2 * Math.SQRT1_2;
    expect(lvl()).toBeCloseTo(c1 + c2, 6);
    e.handleMidi([0x90, 11, 100]); // solo ch1
    expect(e.getStats().anySolo).toBe(true);
    expect(lvl()).toBeCloseTo(c1, 6);
    e.handleMidi([0x90, 31, 100]); // also solo ch2
    expect(lvl()).toBeCloseTo(c1 + c2, 6);
    e.handleMidi([0x90, 10, 100]); // mute ch1 (soloed): mute wins
    expect(lvl()).toBeCloseTo(c2, 6);
    e.handleMidi([0x80, 10, 0]);
    e.handleMidi([0x80, 11, 0]);
    e.handleMidi([0x80, 31, 0]);
    expect(e.getStats().anySolo).toBe(false);
    expect(lvl()).toBeCloseTo(c1 + c2, 6);
  });
  test('cue PFL ignores fader and mute, bypasses master', () => {
    const e = createMixerEngine(spec);
    e.setMasterParam('cueMix', 0); // cue only
    e.setMasterParam('phones', 127);
    e.handleMidi([0x90, 12, 100]); // cue ch1
    e.setParam(0, 'fader', 0);
    e.handleMidi([0x90, 10, 100]); // muted too
    const o = run(e, () => [[dc(0.25), dc(0.25)], [dc(0), dc(0)]], 3);
    expect(o.phones[0][3]).toBeCloseTo(0.25, 6);
    expect(o.master[0].every((v) => v === 0)).toBe(true);
    e.setParam(0, 'fader', 127); // louder fader: PFL unchanged
    expect(run(e, () => [[dc(0.25), dc(0.25)], [dc(0), dc(0)]], 3).phones[0][3]).toBeCloseTo(0.25, 6);
    e.handleMidi([0x80, 12, 0]);
    expect(run(e, () => [[dc(0.25), dc(0.25)], [dc(0), dc(0)]], 3).phones[0][3]).toBe(0);
  });
  test('booth is a copy of master with its own level', () => {
    const e = createMixerEngine(spec);
    e.setMasterParam('booth', 1); // −60 dB
    const o = run(e, () => stereoIn(0.5), 3);
    expect(o.master[0][0]).toBeCloseTo(0.5, 6);
    expect(o.booth[0][0]).toBeCloseTo(0.5 * lin(-60), 6);
  });
  test('FX send → reverb tail on master, deterministic', () => {
    const go = () => {
      const e = createMixerEngine(spec);
      e.setParam(0, 'fxSend', 127);
      e.setParam(0, 'fader', 0); // dry silent; wet follows post-fader so also silent
      return run(e, (b) => stereoIn(b === 0 ? 0.5 : 0), 3);
    };
    expect(go().master[0].every((v) => v === 0)).toBe(true);
    const wet = () => {
      const e = createMixerEngine(spec);
      e.setParam(0, 'fxSend', 127);
      let tail = 0;
      const o = mkOut();
      for (let b = 0; b < 400; b++) {
        e.process(b === 0 ? [[dc(0.5), dc(0.5)]] : [], o);
        if (b > 20) tail = Math.max(tail, ...o.master[0]);
      }
      return tail;
    };
    expect(wet()).toBeGreaterThan(0);
    expect(wet()).toBe(wet());
  });
  test('reverb impulse decays and stays finite', () => {
    const r = new Reverb();
    const i = new Float32Array(BLOCK), z = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
    i[0] = 1;
    let early = 0, late = 0;
    for (let b = 0; b < 1400; b++) {
      r.process(b === 0 ? i : z, b === 0 ? i : z, oL, oR, BLOCK);
      const p = Math.max(...oL.map(Math.abs));
      expect(Number.isFinite(p)).toBe(true);
      if (b < 100) early = Math.max(early, p);
      if (b > 1300) late = Math.max(late, p);
    }
    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early * 0.1);
  });

  describe('MIDI bindings', () => {
    test('resolves via spec.audio → control id → MIDI target', () => {
      const e = createMixerEngine(spec);
      expect(e.handleMidi([0xb0, 20, 33])).toBe(true);
      expect(e.getParam(0, 'fader')).toBe(33);
      expect(e.handleMidi([0xb0, 90, 12])).toBe(true);
      expect(e.getMasterParam('master')).toBe(12);
      expect(e.handleMidi([0xb0, 99, 1])).toBe(false); // unbound
      expect(e.handleMidi([0xb1, 20, 1])).toBe(false); // wrong MIDI channel
      expect(e.handleMidi([0x90, 20, 1])).toBe(false); // wrong type
    });
    test('control min/max range is normalised to 0..127', () => {
      const e = createMixerEngine(spec);
      e.handleMidi([0xb0, 60, 100]); // f2: 0..100
      expect(e.getParam(1, 'fader')).toBe(127);
      e.handleMidi([0xb0, 60, 50]);
      expect(e.getParam(1, 'fader')).toBe(64);
    });
    test('buttons follow their ON/OFF state (note and CC targets)', () => {
      const e = createMixerEngine(spec);
      const sel: string[] = [];
      e.onInputSelect((c, s) => sel.push(`${c}${s}`));
      e.handleMidi([0x90, 10, 100]);
      expect(e.getParam(0, 'mute')).toBe(127);
      e.handleMidi([0x80, 10, 0]);
      expect(e.getParam(0, 'mute')).toBe(0);
      e.handleMidi([0x90, 10, 0]); // note-on vel 0 = off
      expect(e.getParam(0, 'mute')).toBe(0);
      e.handleMidi([0xb0, 29, 127]);
      e.handleMidi([0xb0, 29, 127]); // repeat: no second event
      e.handleMidi([0xb0, 29, 0]);
      expect(sel).toEqual(['0B', '0A']);
    });
    test('input select picks A/B of a 4-array input', () => {
      const e = createMixerEngine(spec);
      const inp = () => [[dc(0.1), dc(0.1), dc(0.3), dc(0.3)]];
      expect(run(e, inp).master[0][0]).toBeCloseTo(0.1, 6);
      e.setInputSelect(0, 'B');
      expect(run(e, inp).master[0][0]).toBeCloseTo(0.3, 6);
    });
  });

  describe('meters and clip', () => {
    test('meter CC goes to the bound Meter midi, at ≤ 30 Hz, only on change', () => {
      const e = createMixerEngine(spec);
      const sent: { block: number; msg: number[] }[] = [];
      let blk = 0;
      e.onMidiOut((msg) => sent.push({ block: blk, msg }));
      const o = mkOut();
      for (blk = 0; blk < 344; blk++) e.process([[dc(0.1), dc(0.1)]], o); // 1 s steady, −20 dBFS
      const ch1 = sent.filter((s) => s.msg[1] === 100);
      expect(ch1.length).toBeLessThanOrEqual(2);
      expect(ch1.at(-1)!.msg).toEqual([0xb0, 100, meterCc(-20)]);
      const m = sent.filter((s) => s.msg[1] === 102).at(-1)!.msg; // master L: ch1 at pan centre keeps unity
      expect(m).toEqual([0xb0, 102, meterCc(-20)]);
      expect(sent.some((s) => s.msg[1] === 101 && s.msg[0] === 0xb1)).toBe(true); // ch2 meter on MIDI channel 2
    });
    test('release ballistics ≈ 20 dB / 300 ms; message rate ≈ 30 Hz', () => {
      const e = createMixerEngine(spec);
      const times: number[] = [];
      let blk = 0;
      e.onMidiOut((msg) => { if (msg[1] === 100) times.push(blk); });
      const o = mkOut();
      e.process([[dc(0.9), dc(0.9)]], o); // one full-scale-ish block (−0.9 dBFS)
      const p0 = e.getStats().channels[0]!.post.peakDb;
      for (blk = 1; blk <= 103; blk++) e.process([[dc(0), dc(0)]], o);
      expect(p0 - e.getStats().channels[0]!.post.peakDb).toBeGreaterThan(19);
      expect(p0 - e.getStats().channels[0]!.post.peakDb).toBeLessThan(21);
      for (; blk < 344; blk++) e.process([[dc(0), dc(0)]], o);
      const gaps = times.slice(1).map((t, i) => t - times[i]!);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(11);
      expect(times.length).toBeGreaterThan(15);
      expect(times.length).toBeLessThanOrEqual(30);
    });
    test('clip flags per stage at ≥ −0.1 dBFS', () => {
      const e = createMixerEngine(spec, { trimDb: [0, -12] });
      const o = mkOut();
      e.process([[dc(0.97), dc(0.97)]], o); // −0.26 dBFS: below threshold
      expect(e.getStats().channels[0]!.clip).toBe(false);
      e.process([[dc(0.99), dc(0.99)]], o); // −0.09 dBFS
      const s = e.getStats();
      expect(s.channels[0]!.adc.clip).toBe(true);
      expect(s.channels[0]!.pre.clip).toBe(true);
      expect(s.master.left.clip).toBe(true);
      // +4 dBu peak (1.228 Vrms*√2 ≈ +4.8 dBV·peak) on ch2 with the 12 dB pad: no ADC clip
      e.process([[dc(0), dc(0)], [dc(1.7), dc(1.7)]], o);
      expect(e.getStats().channels[1]!.adc.clip).toBe(false);
    });
  });
});

describe('levels', () => {
  test('gain staging per module', () => {
    const rows = gainStaging(spec);
    expect(rows[0]!.nominalDbfs).toBeCloseTo(4 - 2.218 - 12, 3); // +4 dBu with the 12 dB pad
    expect(rows[1]!.nominalDbfs).toBeCloseTo(-50 - 2.218 + 40, 3); // mic, 40 dB preamp
    expect(rows[0]!.headroomDb).toBeCloseTo(-0.1 - rows[0]!.nominalDbfs, 6);
  });
});

describe('sources', () => {
  for (const id of Object.keys(SOURCES) as SourceId[]) {
    test(id, () => {
      const [l, r] = renderSource(id, 44100, 1.5);
      expect(l.length).toBe(Math.round(1.5 * 44100));
      expect(r.length).toBe(l.length);
      let pk = 0, nan = false;
      for (const v of l) { pk = Math.max(pk, Math.abs(v)); if (!Number.isFinite(v)) nan = true; }
      expect(nan).toBe(false);
      expect(pk).toBeGreaterThan(0.05);
      expect(pk).toBeLessThanOrEqual(0.5001);
    });
  }
  test('1 kHz tone is −18 dBFS peak', () => {
    const [l] = renderSource('tone1k', 44100, 1);
    expect(Math.max(...l)).toBeCloseTo(lin(-18), 3);
  });
  test('deterministic', () => {
    expect(renderSource('pink', 44100, 0.2)[0]).toEqual(renderSource('pink', 44100, 0.2)[0]);
  });
});

describe('teensy sketch', () => {
  test('two-codec board', () => {
    const s = generateEngineSketch(spec);
    expect(s).toContain('UNPROVEN');
    expect(s).toContain('forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526');
    expect(s).toContain('AudioInputTDM2 tdmIn1');
    expect(s).toContain('AudioControlCS42448 codec1');
    expect(s).toContain('#define N 2');
    expect(s).toContain('// f1'); // bound control listed in the MIDI map
    expect(s.split('{').length).toBe(s.split('}').length);
    expect(s.split('(').length).toBe(s.split(')').length);
  });
  test('single codec board has no second codec', () => {
    const one: DeviceSpec = { ...spec, audio: { ...spec.audio!, board: 'teensy41-cs42448' } };
    const s = generateEngineSketch(one);
    expect(s).not.toContain('codec1');
    expect(s).not.toContain('AudioInputTDM2');
    expect(s).not.toContain('UNPROVEN');
  });
  test('rejects specs without audio', () => {
    expect(() => generateEngineSketch({ ...spec, audio: undefined })).toThrow();
  });
});
