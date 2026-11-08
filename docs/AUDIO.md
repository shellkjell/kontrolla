# kont.rolla audio engine

The surface (RP2040, `docs/CONTRACTS.md`) sends MIDI over a UART port to an audio-engine board
(Teensy 4.1 + CS42448 codec(s), Teensy Audio Library). The engine mixes the channels' audio and sends
meter levels back to the surface as CC. Two things implement the semantics below and must agree:

- the browser model: `packages/audio/src/engine.ts` (pure TS, also runs in an AudioWorklet), the oracle
- the generated sketch: `packages/audio/src/teensy-engine.ts` → `generateEngineSketch(spec)`

All numbers are normative; `packages/audio/src/curves.ts` holds them as code.

**Status.** The model is tested (`bun test packages/audio`). The sketch is **uncompiled and untested on hardware**.
The **two-codec configuration (`teensy41-cs42448x2`) is UNPROVEN**: in the one PJRC forum attempt only the first codec
produced sound
(<https://forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526/>). Breadboard-validate both codecs
before building a PCB. Capacity: one CS42448 has 6 ADC = 3 stereo channels, so 6 channels need the x2 board.

## 1. Format

44.1 kHz, 16-bit on the Teensy (float64 in the model), blocks of 128 samples (2.9 ms). Every channel is stereo L/R;
a mono module (`AudioChannel.stereo = false`) feeds L into both sides (dual-mono). Control values are MIDI CC units 0..127.

## 2. Control input

`spec.audio` binds a param to a surface **control id**; the engine listens to that control's `midi` target
(`channel`, `cc` or `note`). Nothing else is configured on the engine.

- **Analog control (CC):** `v` is normalised by the control's `min..max` to 0..127: `round(clamp((v−min)/(max−min)) · 127)`.
- **Button (note or CC target):** the surface already sends its toggle/momentary state. The engine only follows it:
  ON = Note On vel > 0, or CC ≥ 64; OFF = Note Off, Note On vel 0, or CC < 64. A button bound to a continuous param acts as 127 / 0.
- **Boolean params** (`mute`, `solo`, `cue`, `inputSelect`): value ≥ 64 = on (inputSelect on = B).
- Unbound params keep their defaults: channel gain 106 (0 dB), EQ/filter/pan centre 64, fader 100 (0 dB), fxSend 0, buttons off.
  Master: master 100 (0 dB), booth 127, phones 90, cueMix 64, fxReturn 100.
- **Boot sync:** the surface sends nothing at boot (first scan latches baselines), so the engine sends the snapshot request `F0 7D 6B 01 F7` (CONTRACTS §2.5)
  on the port at boot and the surface answers with every analog value, toggle state and absolute encoder in one burst.

## 3. Signal path (per channel, per side)

```
jack volts ─ trim ─ ADC clamp ─ GAIN ─ EQ (4 biquads) ─ FILTER (1 biquad) ─┬─ [cue tap, PFL] ─────────────→ cue bus
                                                                           └─ FADER ─┬─ peak → channel meter (post-fader)
                                                                                     └─ mute/solo gate × PAN ─┬→ master bus
                                                                                                              └─ × FX SEND → fx bus
master bus + FX RETURN·reverb(fx bus) ─ MASTER fader ─┬→ master out (+ master meters L/R)
                                                      ├─ × BOOTH → booth out
                                                      └─ phones = (cue·cos θ + master·sin θ) · PHONES,  θ = cueMix/127 · π/2
```

Gain changes are ramped linearly across the block (as `AudioAmplifier` does); at steady state they are exact.

### 3.1 Input, trim, INPUT SELECT

Input samples are **jack volts**: 1.0 = 1 Vrms. `trimDb` is the module's net analogue gain jack→ADC (a pad < 0, a mic preamp > 0);
`x·10^(trimDb/20)` is then clamped to ±1 (the ADC clips). INPUT SELECT (A/B) chooses which connector set of a combo module
feeds the channel: in the model `process()` gets `[AL, AR, BL, BR]` and picks; on the Teensy the sketch drives an `INSEL_PIN` (to be
assigned) that switches the module's analogue input. `onInputSelect` fires on every change.

### 3.2 Curves

| Param | CC → value |
|---|---|
| GAIN | 0 = −∞; 1..127 = −60 … +12 dB, linear in dB (`−60 + (cc−1)·72/126`; unity at cc 106) |
| FADER (channel and MASTER) | 0 = −∞; 1..100 = −60 … 0 dB (`−60 + (cc−1)·60/99`); 100..127 = 0 … +6 dB |
| FX SEND, BOOTH, PHONES, FX RETURN | 0 = −∞; 1..127 = −60 … 0 dB (`−60 + (cc−1)·60/126`) |
| EQ band | 0..61 = −26 … ≈ −0.4 dB (`−26·(62−cc)/62`); **62..66 = exactly 0 dB**; 67..127 = ≈ +0.1 … +6 dB (`6·(cc−66)/61`). A band at 0 dB is skipped (bit-transparent). |
| FILTER | 0..61 low-pass, `f = 150·(20000/150)^(cc/61)` Hz (150 Hz … 20 kHz); **62..66 bypass (skipped, bit-transparent)**; 67..127 high-pass, `f = 20·150^((cc−67)/60)` Hz (20 Hz … 3 kHz). Q = 1.0, one 2-pole biquad. |
| PAN | `p = clamp((cc−64)/63, −1, 1)` (cc 64 = centre, ≤ 1 hard left, 127 hard right) |
| CUE MIX | 0 = cue only, 127 = master only; equal power `[cos θ, sin θ]`, `θ = cc/127·π/2` |

**Pan law.** Mono (dual-mono) channel: constant power, `θ = (p+1)·π/4`, `gL = cos θ`, `gR = sin θ` (centre −3 dB per side, `gL²+gR²=1`).
Stereo channel: balance, centre unity; only the far side is attenuated: `p ≤ 0: gL = 1, gR = sin((p+1)π/2)`, `p ≥ 0: gL = cos(pπ/2), gR = 1`.

**EQ bands** (RBJ cookbook, cascade order LO → HI, a0-normalised):

| Param | Type | f0 | Q / slope |
|---|---|---|---|
| `eqLo` | low shelf | 80 Hz | S = 1 |
| `eqLoMid` | peaking | 400 Hz | Q 0.7 |
| `eqHiMid` | peaking | 2.5 kHz | Q 0.7 |
| `eqHi` | high shelf | 8 kHz | S = 1 |

Peak bands reach exactly the target dB at f0; a shelf reaches the target well away from f0 and half of it at f0.
The Teensy library has no peaking type, so the sketch computes all coefficients itself (same formulas) and loads them via
`AudioFilterBiquad::setCoefficients` (Q30, CMSIS sign convention: **unverified**).

### 3.3 Mute, solo, cue

- `audible = !mute && (!anySolo || solo)`. **Solo-in-place:** while any channel is soloed, non-soloed channels are gated off the
  master bus **and the FX send**. Mute wins over solo. The gate is applied after the fader (with the pan gains).
- **CUE = PFL:** tapped after GAIN/EQ/FILTER and **before** the fader; independent of fader, mute and solo. Cue-on channels sum into the
  cue bus, which reaches only the phones (via CUE MIX).
- The channel meter is **post-fader, pre-mute/pan**: it shows what the fader passes.

### 3.4 FX

One stereo FX send/return: classic Freeverb (Jezar) — 8 combs + 4 all-passes per side, right side +23 samples, room size 0.7
(feedback 0.896), damping 0.5, input `(L+R)·0.015`, wet gain ×3. Deterministic (zero-initialised, no modulation, no randomness).
Sketch: `AudioEffectFreeverbStereo` with `roomsize(0.7) damping(0.5)` — same topology; **overall level vs the model is unverified**.
`FX RETURN` sets the wet level into the master bus before the master fader.

### 3.5 Master

`master out = (Σ channels + fxReturn·wet) · MASTER fader`. BOOTH is a copy of the master out times its level. PHONES as in the diagram.
All three outputs clamp at ±1 (DAC full scale), after the clip detector.

## 4. Meters

- Detector: instant attack, release **20 dB per 300 ms** (`p ← max(blockPeak, p·10^(−blockSeconds/0.3))`), per channel
  `max(|L|,|R|)` post-fader; master L and R separately, post master fader.
- dBFS → CC: clamp to −48..0 dBFS, `cc = round(127·(dBFS+48)/48)` (linear in dB).
- Sent at **~30 Hz** (every 1470 samples; 33 ms on the Teensy), **only when the CC changed**, as `B0|(ch−1) cc value` with
  `ch`, `cc` from the bound surface `Meter.midi`. The surface turns it into LEDs (`CONTRACTS §2.1`). Unbound meters send nothing.
- **Clip:** a stage clips at ≥ −0.1 dBFS (0.98855 linear) in a block; the flag holds for 1 s.

## 5. Gain staging

`levels.ts` has the module table (`MODULE_LEVELS`) and `gainStaging(spec)`. dBFS at the ADC = dBV at the jack + `trimDb`, assuming
CS42448 full scale ≈ **1 Vrms** (the design brief's figure at VA 5 V; **not re-checked against the datasheet, and the DAC/output
full scale is unverified**).

| Module | Nominal | Net trim | Nominal at ADC |
|---|---|---|---|
| `io-rca` (consumer) | −10 dBV | 0 dB | −10 dBFS |
| `io-dual-trs` (pro) | +4 dBu = +1.78 dBV | −12 dB pad | −10.2 dBFS |
| `io-xlr` (mic) | −50 dBu = −52.2 dBV | +40 dB preamp (default) | −12.2 dBFS |
| `io-trs-rca-combo` | A pro / B consumer | −12 dB (A); table models A | −10.2 dBFS |

(The catalog's own IO_MODULES may supersede this table; unknown ids fall back to consumer.)

Clipping is reported per stage in `getStats()`: **adc** (after trim, before the clamp), **pre** (after GAIN/EQ/FILTER, before the
fader — where the 16-bit Teensy path saturates), **post** (after the fader), and **master** L/R. The model computes in float, so
only `adc` and the output clamp actually distort; `pre`/`post` flags warn about what the 16-bit Teensy path would clip.
A sum of channels near full scale clips the master bus on the Teensy (mixers saturate).

## 6. API (`@kontrolla/audio`)

```ts
createMixerEngine(spec: DeviceSpec, opts?: { sampleRate?, trimDb?: number[], meterHz? }): MixerEngine
createAudioEngineNode(ctx, spec, inputs: (AudioNode|null)[], opts?: { trimDb?, workletUrl? }): Promise<AudioEngineNode>
generateEngineSketch(spec): string
renderSource(id, sampleRate?, seconds?): [Float32Array, Float32Array];  playSource(ctx, id, dest)
gainStaging(spec): StagingRow[]
```

See the types in `engine.ts` / `client.ts`. The worklet has N stereo inputs (one per channel) and 3 stereo outputs
`[master, booth, phones]` (`OUTPUT.master|booth|phones`).
