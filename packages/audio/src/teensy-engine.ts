// Generates the Teensy 4.1 + CS42448 audio-engine sketch for spec.audio. Same curves as curves.ts / docs/AUDIO.md.
import type { DeviceSpec } from '@kontrolla/core';
import { CHANNEL_DEFAULTS, CHANNEL_PARAMS, MASTER_DEFAULTS, MASTER_PARAMS } from './engine';

type Src = [node: string, port: number];

class Gen {
  objs: string[] = [];
  cords: string[] = [];
  private n = 0;
  obj(type: string, name: string) { this.objs.push(`${type} ${name};`); return name; }
  cord(s: Src, d: Src) { this.cords.push(`AudioConnection pc${this.n++}(${s[0]}, ${s[1]}, ${d[0]}, ${d[1]});`); }
  /** Sum any number of sources through AudioMixer4 trees (unity gains). */
  tree(prefix: string, srcs: Src[]): Src {
    let level = 0, cur = srcs;
    while (cur.length > 1) {
      const next: Src[] = [];
      for (let i = 0; i < cur.length; i += 4) {
        const grp = cur.slice(i, i + 4);
        if (grp.length === 1) { next.push(grp[0]!); continue; }
        const m = this.obj('AudioMixer4', `${prefix}_m${level}_${i / 4}`);
        grp.forEach((s, p) => this.cord(s, [m, p]));
        next.push([m, 0]);
      }
      cur = next;
      level++;
    }
    return cur[0]!;
  }
}

const EQ_STAGE: Record<string, number> = { eqLo: 0, eqLoMid: 1, eqHiMid: 2, eqHi: 3 };

export function generateEngineSketch(spec: DeviceSpec): string {
  const audio = spec.audio;
  if (!audio) throw new Error('spec.audio is not set');
  const codecs = audio.board.endsWith('x2') ? 2 : 1;
  const cap = codecs * 3; // CS42448: 6 ADC = 3 stereo channels per codec
  const chs = audio.channels.slice(0, cap);
  const N = chs.length;
  const g = new Gen();

  // ---- I/O ----
  const tdmIn = [0, 1].slice(0, codecs).map((k) => g.obj(k ? 'AudioInputTDM2' : 'AudioInputTDM', `tdmIn${k}`));
  const tdmOut = [0, 1].slice(0, codecs).map((k) => g.obj(k ? 'AudioOutputTDM2' : 'AudioOutputTDM', `tdmOut${k}`));

  // ---- channel strips ----
  const st = chs.map((_, i) => {
    const o = (t: string, n: string) => g.obj(t, `c${i}_${n}`);
    return {
      gain: [o('AudioAmplifier', 'gL'), o('AudioAmplifier', 'gR')],
      eq: [o('AudioFilterBiquad', 'eqL'), o('AudioFilterBiquad', 'eqR')],
      flt: [o('AudioFilterBiquad', 'fltL'), o('AudioFilterBiquad', 'fltR')],
      cue: [o('AudioAmplifier', 'cueL'), o('AudioAmplifier', 'cueR')],
      fad: [o('AudioAmplifier', 'fadL'), o('AudioAmplifier', 'fadR')],
      pk: [o('AudioAnalyzePeak', 'pkL'), o('AudioAnalyzePeak', 'pkR')],
      pan: [o('AudioAmplifier', 'panL'), o('AudioAmplifier', 'panR')],
      snd: [o('AudioAmplifier', 'sndL'), o('AudioAmplifier', 'sndR')],
    };
  });
  chs.forEach((c, i) => {
    const s = st[i]!, k = Math.floor(i / 3), slot = (i % 3) * 2;
    for (let side = 0; side < 2; side++) {
      const slotSide = c.stereo ? slot + side : slot; // dual-mono: both chains read the L slot
      g.cord([tdmIn[k]!, slotSide], [s.gain[side]!, 0]);
      g.cord([s.gain[side]!, 0], [s.eq[side]!, 0]);
      g.cord([s.eq[side]!, 0], [s.flt[side]!, 0]);
      g.cord([s.flt[side]!, 0], [s.cue[side]!, 0]); // PFL tap: pre-fader
      g.cord([s.flt[side]!, 0], [s.fad[side]!, 0]);
      g.cord([s.fad[side]!, 0], [s.pk[side]!, 0]); // meter: post-fader, pre-mute/pan
      g.cord([s.fad[side]!, 0], [s.pan[side]!, 0]);
      g.cord([s.pan[side]!, 0], [s.snd[side]!, 0]);
    }
  });

  // ---- buses ----
  const fxIn = g.tree('fxin', st.flatMap((s) => [[s.snd[0]!, 0], [s.snd[1]!, 0]] as Src[]));
  const fv = g.obj('AudioEffectFreeverbStereo', 'fv');
  g.cord(fxIn, [fv, 0]);
  const fxr = [g.obj('AudioAmplifier', 'fxrL'), g.obj('AudioAmplifier', 'fxrR')];
  g.cord([fv, 0], [fxr[0]!, 0]);
  g.cord([fv, 1], [fxr[1]!, 0]);
  const side = (n: 0 | 1, nm: string) => {
    const bus = g.tree(`bus${nm}`, [...st.map((s) => [s.pan[n]!, 0] as Src), [fxr[n]!, 0] as Src]);
    const cue = g.tree(`cue${nm}`, st.map((s) => [s.cue[n]!, 0] as Src));
    const mast = g.obj('AudioAmplifier', `mast${nm}`);
    const booth = g.obj('AudioAmplifier', `booth${nm}`);
    const pm = g.obj('AudioMixer4', `pm${nm}`);
    const ph = g.obj('AudioAmplifier', `ph${nm}`);
    const mpk = g.obj('AudioAnalyzePeak', `mpk${nm}`);
    g.cord(bus, [mast, 0]);
    g.cord([mast, 0], [mpk, 0]);
    g.cord([mast, 0], [booth, 0]);
    g.cord(cue, [pm, 0]);
    g.cord([mast, 0], [pm, 1]);
    g.cord([pm, 0], [ph, 0]);
    g.cord([mast, 0], [tdmOut[0]!, n]);
    g.cord([booth, 0], [tdmOut[0]!, 2 + n]);
    g.cord([ph, 0], [tdmOut[0]!, 4 + n]);
    return { mast, booth, pm, ph, mpk };
  };
  const mL = side(0, 'L'), mR = side(1, 'R');

  // ---- tables ----
  const ptr2 = (f: (s: (typeof st)[number]) => string[]) => st.map((s) => `{ &${f(s)[0]}, &${f(s)[1]} }`).join(', ');
  const ctlById = new Map(spec.controls.map((c) => [c.id, c]));
  const binds: string[] = [];
  const addBind = (strip: number, param: number, id: string | undefined, isMaster: boolean) => {
    const c = id ? ctlById.get(id) : undefined;
    if (!c) return;
    const m = c.midi;
    const note = m.type === 'note';
    binds.push(
      `  { ${note ? 1 : 0}, ${m.channel}, ${note ? m.note : m.cc}, ${note ? 0 : m.min}, ${note ? 127 : m.max}, ${isMaster ? 255 : strip}, ${param}, ${c.kind === 'button' ? 1 : 0} }, // ${id}`,
    );
  };
  chs.forEach((c, i) => CHANNEL_PARAMS.forEach((p, pi) => addBind(i, pi, c.bind[p], false)));
  MASTER_PARAMS.forEach((p, pi) => addBind(0, pi, audio.master.bind[p], true));
  const meterMidi = (id?: string) => spec.meters?.find((m) => m.id === id)?.midi;
  const mrow = (m?: { channel: number; cc: number }) => (m ? `{ ${m.channel - 1}, ${m.cc} }` : '{ 255, 0 }');
  const chMeters = chs.map((c) => mrow(meterMidi(c.meter))).join(', ');
  const mMeters = [audio.master.meters?.left, audio.master.meters?.right].map((id) => mrow(meterMidi(id))).join(', ');

  const defs = CHANNEL_PARAMS.map((p, i) => `#define P_${p.toUpperCase()} ${i}`).join('\n');
  const mdefs = MASTER_PARAMS.map((p, i) => `#define M_${p.toUpperCase()} ${i}`).join('\n');
  const chDef = CHANNEL_PARAMS.map((p) => CHANNEL_DEFAULTS[p]).join(', ');
  const mDef = MASTER_PARAMS.map((p) => MASTER_DEFAULTS[p]).join(', ');
  const eqCases = Object.entries(EQ_STAGE).map(([p, s]) => `    case P_${p.toUpperCase()}: setEq(s, ${s}, v); break;`).join('\n');
  const truncated = audio.channels.length > cap ? `\n// WARNING: ${audio.channels.length} channels in the spec but ${audio.board} has ${cap}; channels ${cap}+ are dropped.` : '';

  return `// ${spec.name}: audio engine (Teensy 4.1 + CS42448${codecs > 1 ? ' x2' : ''}), generated by @kontrolla/audio. Semantics: docs/AUDIO.md.
// UNCOMPILED and untested on hardware: written against the PJRC Audio Library API from memory.
${codecs > 1 ? `// The TWO-CODEC configuration is UNPROVEN: in the one PJRC forum attempt only the first codec produced sound
// (https://forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526/).
// Breadboard-validate both codecs (AudioInputTDM + AudioInputTDM2, I2C addressing of the second AudioControlCS42448) before building a PCB.
` : ''}// Unverified: AudioFilterBiquad::setCoefficients Q30 sign convention (CMSIS: a1/a2 negated), CS42448 full-scale voltage, output FS, Freeverb level vs the TS model.${truncated}
// Wiring: MIDI from the surface on Serial1 (31250 baud, RX = pin 0, TX = pin 1); meter CCs go back on TX.
#include <Audio.h>
#include <Wire.h>
#include <math.h>

#define N ${N}
${defs}
${mdefs}

// ---- audio graph ----
${g.objs.join('\n')}
AudioControlCS42448 codec0;
${codecs > 1 ? 'AudioControlCS42448 codec1; // second codec: bus/address handling UNPROVEN\n' : ''}${g.cords.join('\n')}

AudioFilterBiquad *EQ[N][2] = { ${ptr2((s) => s.eq)} };
AudioFilterBiquad *FLT[N][2] = { ${ptr2((s) => s.flt)} };
AudioAmplifier *GAIN[N][2] = { ${ptr2((s) => s.gain)} };
AudioAmplifier *CUE[N][2] = { ${ptr2((s) => s.cue)} };
AudioAmplifier *FAD[N][2] = { ${ptr2((s) => s.fad)} };
AudioAmplifier *PAN[N][2] = { ${ptr2((s) => s.pan)} };
AudioAmplifier *SND[N][2] = { ${ptr2((s) => s.snd)} };
AudioAnalyzePeak *PK[N][2] = { ${ptr2((s) => s.pk)} };
const bool STEREO[N] = { ${chs.map((c) => (c.stereo ? 'true' : 'false')).join(', ')} };
// A/B select pins for combo modules (-1 = none). ASSIGN real pins; they switch the module's analogue input.
int INSEL_PIN[N] = { ${chs.map(() => '-1').join(', ')} };

// ---- MIDI map (from spec.audio bindings) ----
struct Bind { uint8_t note, ch, num, lo, hi, strip, param, btn; };
const Bind BINDS[] = {
${binds.join('\n') || '  { 0, 0, 0, 0, 0, 255, 255, 0 }, // none'}
};
struct MeterOut { uint8_t ch, cc; };
const MeterOut CH_METER[N] = { ${chMeters} };
const MeterOut M_METER[2] = { ${mMeters} };

uint8_t cc[N][13] = {};
uint8_t mcc[5] = { ${mDef} };
const uint8_t CH_DEF[13] = { ${chDef} };

// ---- curves (identical to curves.ts) ----
struct Co { double b0, b1, b2, a1, a2; };
static float dbLin(float db) { return powf(10.f, db / 20.f); }
static float gainLin(int v) { return v <= 0 ? 0.f : dbLin(-60.f + (v - 1) * 72.f / 126.f); }
static float faderLin(int v) { return v <= 0 ? 0.f : dbLin(v <= 100 ? -60.f + (v - 1) * 60.f / 99.f : (v - 100) * 6.f / 27.f); }
static float levelLin(int v) { return v <= 0 ? 0.f : dbLin(-60.f + (v - 1) * 60.f / 126.f); }
static float eqDbOf(int v) { if (v >= 62 && v <= 66) return 0.f; return v < 62 ? -26.f * (62 - v) / 62.f : 6.f * (v - 66) / 61.f; }
static Co mk(double b0, double b1, double b2, double a0, double a1, double a2) { return { b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0 }; }
static const Co ID = { 1, 0, 0, 0, 0 };
static Co peaking(double f, double db, double q) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / AUDIO_SAMPLE_RATE_EXACT, c = cos(w), al = sin(w) / (2 * q);
  return mk(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
}
static Co lowShelf(double f, double db) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / AUDIO_SAMPLE_RATE_EXACT, c = cos(w), s = 2 * sqrt(A) * (sin(w) / M_SQRT2);
  return mk(A * (A + 1 - (A - 1) * c + s), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - s),
            A + 1 + (A - 1) * c + s, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - s);
}
static Co highShelf(double f, double db) {
  double A = pow(10, db / 40), w = 2 * M_PI * f / AUDIO_SAMPLE_RATE_EXACT, c = cos(w), s = 2 * sqrt(A) * (sin(w) / M_SQRT2);
  return mk(A * (A + 1 + (A - 1) * c + s), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - s),
            A + 1 - (A - 1) * c + s, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - s);
}
static Co lowpass(double f, double q) {
  double w = 2 * M_PI * f / AUDIO_SAMPLE_RATE_EXACT, c = cos(w), al = sin(w) / (2 * q);
  return mk((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
}
static Co highpass(double f, double q) {
  double w = 2 * M_PI * f / AUDIO_SAMPLE_RATE_EXACT, c = cos(w), al = sin(w) / (2 * q);
  return mk((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}
static void setBq(AudioFilterBiquad *f, int stage, Co c) {
  double v[5] = { c.b0, c.b1, c.b2, -c.a1, -c.a2 }; // CMSIS DF1 convention, Q30
  int q[5];
  for (int i = 0; i < 5; i++) { double x = v[i] * 1073741824.0; if (x > 2147483647.0) x = 2147483647.0; if (x < -2147483648.0) x = -2147483648.0; q[i] = (int)x; }
  f->setCoefficients(stage, q);
}

// ---- parameter application ----
static bool anySolo() { for (int i = 0; i < N; i++) if (cc[i][P_SOLO] >= 64) return true; return false; }
static void applyPan(int s, bool solo) {
  bool audible = cc[s][P_MUTE] < 64 && (!solo || cc[s][P_SOLO] >= 64);
  float p = (cc[s][P_PAN] - 64) / 63.f; if (p < -1) p = -1; if (p > 1) p = 1;
  float l, r;
  if (STEREO[s]) { if (p <= 0) { l = 1; r = sinf((p + 1) * M_PI / 2); } else { l = cosf(p * M_PI / 2); r = 1; } }
  else { float th = (p + 1) * M_PI / 4; l = cosf(th); r = sinf(th); }
  PAN[s][0]->gain(audible ? l : 0.f);
  PAN[s][1]->gain(audible ? r : 0.f);
}
static void setEq(int s, int stage, int v) {
  float db = eqDbOf(v); Co c = ID;
  if (db != 0.f) c = stage == 0 ? lowShelf(80, db) : stage == 1 ? peaking(400, db, 0.7) : stage == 2 ? peaking(2500, db, 0.7) : highShelf(8000, db);
  setBq(EQ[s][0], stage, c); setBq(EQ[s][1], stage, c);
}
static void setFilter(int s, int v) {
  Co c = ID;
  if (v < 62) c = lowpass(150.0 * pow(20000.0 / 150.0, v / 61.0), 1.0);
  else if (v > 66) c = highpass(20.0 * pow(150.0, (v - 67) / 60.0), 1.0);
  setBq(FLT[s][0], 0, c); setBq(FLT[s][1], 0, c);
}
static void applyCh(int s, int p) {
  int v = cc[s][p];
  switch (p) {
    case P_GAIN: GAIN[s][0]->gain(gainLin(v)); GAIN[s][1]->gain(gainLin(v)); break;
${eqCases}
    case P_FILTER: setFilter(s, v); break;
    case P_FXSEND: SND[s][0]->gain(levelLin(v)); SND[s][1]->gain(levelLin(v)); break;
    case P_PAN: applyPan(s, anySolo()); break;
    case P_FADER: FAD[s][0]->gain(faderLin(v)); FAD[s][1]->gain(faderLin(v)); break;
    case P_MUTE: case P_SOLO: { bool so = anySolo(); for (int i = 0; i < N; i++) applyPan(i, so); } break;
    case P_CUE: CUE[s][0]->gain(v >= 64 ? 1.f : 0.f); CUE[s][1]->gain(v >= 64 ? 1.f : 0.f); break;
    case P_INPUTSELECT: if (INSEL_PIN[s] >= 0) digitalWrite(INSEL_PIN[s], v >= 64 ? HIGH : LOW); break;
  }
}
static void applyMaster(int p) {
  int v = mcc[p];
  switch (p) {
    case M_MASTER: mastL.gain(faderLin(v)); mastR.gain(faderLin(v)); break;
    case M_BOOTH: boothL.gain(levelLin(v)); boothR.gain(levelLin(v)); break;
    case M_PHONES: phL.gain(levelLin(v)); phR.gain(levelLin(v)); break;
    case M_CUEMIX: { float th = v / 127.f * M_PI / 2; pmL.gain(0, cosf(th)); pmR.gain(0, cosf(th)); pmL.gain(1, sinf(th)); pmR.gain(1, sinf(th)); } break;
    case M_FXRETURN: fxrL.gain(levelLin(v)); fxrR.gain(levelLin(v)); break;
  }
}

// ---- MIDI in ----
static void onMsg(uint8_t st, uint8_t d1, uint8_t d2) {
  uint8_t type = st & 0xF0, ch = (st & 0x0F) + 1, note;
  bool on;
  if (type == 0x90 || type == 0x80) { note = 1; on = type == 0x90 && d2 > 0; }
  else if (type == 0xB0) { note = 0; on = d2 >= 64; }
  else return;
  for (unsigned i = 0; i < sizeof(BINDS) / sizeof(BINDS[0]); i++) {
    const Bind &b = BINDS[i];
    if (b.param == 255 || b.note != note || b.ch != ch || b.num != d1) continue;
    int v;
    if (note || b.btn) v = on ? 127 : 0;
    else {
      float span = (float)b.hi - b.lo, t = span == 0 ? d2 / 127.f : (d2 - b.lo) / span;
      if (t < 0) t = 0; if (t > 1) t = 1;
      v = (int)(t * 127.f + 0.5f);
    }
    if (b.strip == 255) { mcc[b.param] = v; applyMaster(b.param); continue; }
    if (b.param >= P_MUTE) v = v >= 64 ? 127 : 0;
    cc[b.strip][b.param] = v;
    applyCh(b.strip, b.param);
  }
}
static void pollMidi() {
  static uint8_t st = 0, d[2], n = 0;
  while (Serial1.available()) {
    uint8_t b = Serial1.read();
    if (b >= 0xF8) continue;
    if (b & 0x80) { st = b >= 0xF0 ? 0 : b; n = 0; continue; }
    if (!st) continue;
    d[n++] = b;
    if (n == ((st & 0xE0) == 0xC0 ? 1 : 2)) { onMsg(st, d[0], n > 1 ? d[1] : 0); n = 0; }
  }
}

// ---- meters out: 30 Hz, only changed, 20 dB / 300 ms release ----
static int meterCc(float p) {
  if (p <= 0) return 0;
  float db = 20.f * log10f(p); if (db < -48.f) db = -48.f; if (db > 0.f) db = 0.f;
  return (int)(127.f * (db + 48.f) / 48.f + 0.5f);
}
static void sendCc(const MeterOut &m, int v) { Serial1.write(0xB0 | m.ch); Serial1.write(m.cc); Serial1.write(v); }
static void meterTick(float dt) {
  static float lvl[N + 2]; static int last[N + 2];
  static bool first = true;
  if (first) { for (int i = 0; i < N + 2; i++) last[i] = -1; first = false; }
  float decay = powf(10.f, -dt / 0.3f);
  for (int i = 0; i < N + 2; i++) {
    float p = 0;
    AudioAnalyzePeak *a = i < N ? PK[i][0] : (i == N ? &mpkL : &mpkR), *b = i < N ? PK[i][1] : nullptr;
    if (a->available()) p = a->read();
    if (b && b->available()) { float q = b->read(); if (q > p) p = q; }
    lvl[i] = p > lvl[i] * decay ? p : lvl[i] * decay;
    int v = meterCc(lvl[i]);
    if (v == last[i]) continue;
    last[i] = v;
    const MeterOut &m = i < N ? CH_METER[i] : M_METER[i - N];
    if (m.ch != 255) sendCc(m, v);
  }
}

void setup() {
  Serial1.begin(31250);
  AudioMemory(${40 + 6 * N});
  codec0.enable(); codec0.volume(1.0);
${codecs > 1 ? '  codec1.enable(); codec1.volume(1.0); // UNPROVEN\n' : ''}  for (int i = 0; i < N; i++) {
    if (INSEL_PIN[i] >= 0) pinMode(INSEL_PIN[i], OUTPUT);
    for (int st = 1; st < 4; st++) { setBq(FLT[i][0], st, ID); setBq(FLT[i][1], st, ID); } // unused stages must not mute
    for (int p = 0; p < 13; p++) cc[i][p] = CH_DEF[p];
    for (int p = 0; p < 13; p++) applyCh(i, p);
  }
  for (int p = 0; p < 5; p++) applyMaster(p);
  fv.roomsize(0.7f); fv.damping(0.5f);
}

void loop() {
  static uint32_t t0 = 0;
  pollMidi();
  uint32_t now = millis();
  if (now - t0 >= 33) { meterTick((now - t0) / 1000.f); t0 = now; }
}
`;
}
