# kont.rolla contracts

Types live in `packages/core/src/types.ts`. Two things implement the device
semantics independently:

- the RP2040 firmware (C, `firmware/rp2040`), which runs in rp2040js
- the behavioural model (TS, `packages/core`), which simulates Teensy and acts as the oracle

They must produce **the same MIDI message sequence** for the same stimulus
script when noise is off. Timestamps may differ. Differential tests enforce this.

## 1. Config blob (RP2040)

The firmware is one generic image. The device spec is encoded into a blob at
flash offset `0x1F0000`, which is XIP address `0x101F0000`. The blob is at most
4096 bytes and little-endian.

| off | size | field |
|----:|-----:|-------|
| 0  | 4  | magic `0x314C524B` ("KRL1") |
| 4  | 2  | version = 1 |
| 6  | 2  | total length in bytes, including the CRC |
| 8  | 1  | controlCount |
| 9  | 1  | muxCount |
| 10 | 2  | reserved = 0 |
| 12 | 32 | usbProductName, ASCII, NUL-padded, max 31 chars |
| 44 | 8×muxCount | mux records |
| …  | 16×controlCount | control records, in `spec.controls` order |
| …  | 4  | CRC32 (IEEE/zlib) over all preceding bytes |

**Mux record (8 B):** `u8 sigAdc` (ADC channel 0-2), `u8 sel[4]` (GPIO for S0..S3), `u8 pad[3]`=0.

**Control record (16 B):**

| off | field |
|---:|---|
| 0 | kind: 1 = analog (pot/fader), 2 = button, 3 = encoder |
| 1 | pinA: analog = ADC channel 0-2, or 0xFF if on a mux; button = GPIO; encoder = GPIO A |
| 2 | pinB: encoder = GPIO B; otherwise 0xFF |
| 3 | muxIndex (0xFF = none) |
| 4 | muxChannel 0-15 |
| 5 | midiType: 1 = CC, 2 = note |
| 6 | channel 0-15 (spec channel − 1) |
| 7 | number (CC # or note #) |
| 8 | min (CC min; note: 0) |
| 9 | max (CC max; note: velocity) |
| 10 | flags: bit0 = toggle, bit1 = relative |
| 11 | debounceMs |
| 12 | deadband |
| 13 | smoothing |
| 14 | pad[2] = 0 |

RP2040 ADC channel n ↔ GPIO 26+n. ADC3 (GPIO29) is not usable on the Pico.

**Invalid blob** (bad magic, CRC, or version): the firmware still enumerates as
USB MIDI with product name `kont.rolla (no config)`, sends nothing, and blinks
GPIO25.

USB IDs: VID `0x1209`, PID `0x0001` (pid.codes test PID; hobby/dev only).
Single USB-MIDI cable 0. No running status.

## 2. Semantics (firmware and model must match)

There is one **scan every 1 ms**. Controls are processed in record order on
each scan, and every MIDI message is emitted immediately in that order.

### Analog (pot/fader)

The raw value `raw` is 0..4095. For a mux control: drive S0..S3 to
`channel` bits (S0 = LSB), wait 10 µs, then read `sigAdc`.

```
k   = 256 - smoothing
first scan: acc = raw << 4
else:       acc = acc + ((((raw << 4) - acc) * k) >> 8)   // signed, arithmetic shift
s   = acc >> 4
v   = min + floor((s * (max - min) + 2047) / 4095)
first scan: lastS = s; lastV = v; no message
else if v != lastV && |s - lastS| >= deadband: send CC(v); lastV = v; lastS = s
```

### Button

The input uses the internal pull-up, so **pressed = pin low**.

```
stable starts released, counter = 0
each scan: if raw == stable: counter = 0
           else: counter++; if counter >= debounceMs (or debounceMs == 0): stable = raw; counter = 0; edge(stable)
```

- **Momentary:** press sends ON, release sends OFF.
- **Toggle:** each press flips the state and sends ON or OFF. Releases send nothing. The state starts OFF.
- **Note target:** ON = `90|ch note velocity`, OFF = `80|ch note 0`.
- **CC target:** ON = `B0|ch cc max`, OFF = `B0|ch cc min`.

### Encoder

The inputs use pull-ups. `state = (A << 1) | B`, sampled every scan. The rest
(detent) position is `0b11`.

```
TABLE = [0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0]   // index = (prev << 2) | cur
q += TABLE[(prev << 2) | cur]; prev = cur
q >= 4: detent +1, q = 0      q <= -4: detent -1, q = 0
```

Clockwise is `11 → 01 → 00 → 10 → 11`, which gives +1.

- **Absolute:** `value` starts at `min`. Each detent adds ±1 and is clamped to `min..max`. Send `CC(value)` when the value changes.
- **Relative:** each detent sends `CC(65)` for clockwise or `CC(63)` for counter-clockwise, without clamping.

## 3. Stimulus (shared physical layer, `packages/core/src/physics.ts`)

- `setAnalog(id, x)`: `raw = round(clamp(x, 0, 1) * 4095)` (linear taper), plus seeded noise of ±`analogNoiseLsb` on each read, clamped to 0..4095.
- `setButton(id, p)`: drives the pin low when pressed. With `buttonBounceMs > 0`, each edge toggles at seeded random times within that window before settling.
- `turnEncoder(id, n)`: |n| detents. Each detent is 4 transitions spaced **2 ms** apart, using the clockwise sequence `01, 00, 10, 11` or its reverse `10, 00, 01, 11`. The turns are queued and played out in simulated time by `advance()`.

## 4. Fidelity

| MCU | DeviceSim | Fidelity |
|-----|-----------|----------|
| rp2040-pico | `@kontrolla/emulator` → `createRp2040Device(spec, firmwareBin)` | `firmware` (real binary, instruction-level) |
| teensy41 | `@kontrolla/core` → `createModelDevice(spec)` | `model` (behavioural; generated sketch is not executed) |

Neither sim covers EMI, ground loops, or supply sag. Validation rules cover
current budget and pin conflicts statically.
