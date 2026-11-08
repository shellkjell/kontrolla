# kont.rolla I/O slot standard

Audio inputs live on small **module plates** that bolt into **rear slots**. One slot = one mixer channel. Swapping the
module in a slot changes that channel's input type (two 6.3 mm jacks, RCA, XLR mic, ...) without touching the rest of the
mixer. Master outputs use the same plates in fixed slots; phones jacks sit on the top panel.

The data lives in code: `IO_MODULES`, `AUDIO_BOARDS`, `POWER_BOARD` in `packages/core/src/catalog.ts`; bindings in
`spec.ioSlots` and `spec.audio` (`docs/CONTRACTS.md`, `docs/AUDIO.md`). This document is the mechanical and electrical
standard those numbers come from.

**Status: a design standard, nothing built.** Items marked **[FLAG]** are unverified or candidates. Everything with
`maturity: 'experimental'` in the catalog is the same list.

| What | Status |
|---|---|
| Teensy 4.1 + **one** CS42448 (6 in / 8 out = 3 stereo channels) | proven (Teensy Audio Library `AudioControlCS42448`, TDM) |
| Teensy 4.1 + **two** CS42448 (12 in / 16 out = 6 stereo channels, TDM + TDM2) | **UNPROVEN.** In the one PJRC forum attempt only the first codec produced sound: <https://forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526/>. Breadboard before any PCB. |
| Teensy Audio Library format | 16-bit / 44.1 kHz |
| CS42448 ADC full scale | about 1 Vrms differential at VA = 5 V (design brief). **[FLAG]** DAC output full scale not verified. |
| Mic preamp THAT1510 / THAT1512 (pin-compatible with INA217 / INA163) | well-known parts, module not built |
| Phantom power | open design: <https://github.com/ojg/thatmicpre> (48 V, about 30 mA) |
| Line receivers INA137 / INA2137 / THAT1246, XLR drivers DRV134 / THAT1646, phones amp TPA6120 / NJM4556 | **[FLAG]** candidates, unverified |
| A/B relay Panasonic TQ2-5V (DPDT) | **[FLAG]** candidate; coil current not budgeted |
| USB-C PD sink HUSB238 (Adafruit 5991) | candidate; CH224K boards have been reported to reset-loop |

## 1. Mechanical

### 1.1 The D-size footprint

Neutrik's D-size connectors (XLR `NC3FD-L-1` female / `NC3MD-L-1` male, D-size jacks such as `NMJ6HFD2`) share one panel
footprint:

- round panel cut-out **24 mm** (Neutrik datasheet: "Standardized D sized 24 mm panel cutout"),
- panel thickness 1-3 mm, M3 countersunk screws,
- flange **31 x 26 mm** (the NJ3FP6C datasheet says its flange is "dimensionally compatible with D Series (31 x 26 mm)").

**[FLAG]** The datasheet text does not give the flange outline or the screw spacing. The diagonal 19 x 26 mm screw pattern
used here (screws at +/-9.5 mm, +/-13 mm from the centre, top-left and bottom-right) comes from a distributor catalogue
("mounting hole ALL 19 26") and from the photo (screws at two opposite corners). Check the Neutrik drawing before you cut
metal. Also unchecked: that the D-size **jacks** use the same 24 mm cut-out.

### 1.2 The slot

Two D flanges stacked (the dual-XLR case) set the slot size:

```
opening height  = 2 x 31 (flanges) + 4 (gap)         = 66 mm
opening width   = 26 (flange) + 2 x 3 (clearance)    = 32 mm
screw ears      = one M3 hole 3.5 mm above and below the opening  -> holes at +/-36.5 mm from the centre
slot row height = 66 + 2 x 7 = 80 mm
slot pitch      = 37 mm (= 32 mm opening + 5 mm wall), the strip pitch of the Portable Mixer preset
```

The rear wall opening is **32 x 66 mm**; the module plate (**32 x 80 x 2 mm**, `exportModulePlateStl`) sits in it with its two
ears against the inside of the wall, held by two **M3** screws (Ø3.2 holes). An empty slot gets a blank plate (same plate,
no connector holes; ID pin open). The catalog part `io-slot` carries these numbers; the layout engine (`autoLayout`)
places one slot per audio channel on the rear wall, behind the strip it serves, and raises the rear height to fit.

The rear wall has two rows: the **service row** at the bottom (USB opening, MIDI jack, USB-C power opening) and the **slot
row** above it. That makes the rear wall about 106-108 mm tall for a mixer; the top panel slopes down to a 21 mm front lip.

Connector positions on a plate (mm from the plate centre, +y down):

| Module | Connectors |
|---|---|
| dual XLR / dual TRS / XLR pair out | two D-size parts at y = -17.5 and +17.5 |
| single XLR / stereo TRS / stereo mini | one part at the centre |
| dual mini | two 3.5 mm jacks at y = -10 and +10 |
| RCA / booth out | two RCA jacks at y = -12 and +12 |
| TRS + RCA (A/B in, master combo out) | 6.3 mm pair at y = -17 (x = -8, +8), RCA pair at y = +17 (x = -8, +8) |

## 2. Electrical: the module header

One **2 x 8, 2.54 mm IDC** header per module (16 pins), cable to the engine board and power board.

| Pin | Signal | Notes |
|---:|---|---|
| 1 | +12 V | analog front ends |
| 2 | -12 V | |
| 3 | +5 V | relay coils, logic |
| 4 | +48 V | phantom supply; **switched on the module** |
| 5 | AGND | analog ground |
| 6 | AGND | |
| 7 | DGND | digital ground (SEL, PH_EN, ID return) |
| 8 | SEL | engine -> module, 3.3 V logic. A/B input select (0 = A, 1 = B); on output modules it selects the jack pair |
| 9 | L+ | balanced pair at the codec level (below) |
| 10 | L- | |
| 11 | R+ | |
| 12 | R- | |
| 13 | ID | module resistor to AGND, read by the engine (below) |
| 14 | PH_EN | engine -> module, 3.3 V logic: phantom on/off (optional: a slide switch on the module is fine) |
| 15 | DGND | |
| 16 | CHASSIS | shield / chassis tie, to the enclosure ground at one point only |

Input modules drive pins 9-12; output modules receive them (the engine/DAC side drives the pair, the module's driver makes
the line out). AGND and DGND meet at one star point on the power board.

### 2.1 Signal level at the header

Standard level at pins 9-12: the **CS42448 full scale, about 1 Vrms differential = 0 dBFS**. Modules scale to it:

| Input | Nominal at the jack | Module gain | Lands at |
|---|---|---|---|
| RCA, 3.5 mm, stereo TRS (consumer) | -10 dBV | 0 dB | about -10 dBFS |
| 6.3 mm TRS pair (pro) | +4 dBu (+1.8 dBV) | -12 dB pad | about -10 dBFS |
| XLR mic | -50 dBu (-52.2 dBV) | +40 dB (20-60 dB by resistor) | about -12 dBFS |

The numbers match `MODULE_LEVELS` in `packages/audio/src/levels.ts`. The test tone for bring-up is a 1 kHz sine at -18 dBFS.

### 2.2 Module ID (resistor ladder)

The ID pin goes to AGND through a resistor on the module; the engine side has a **10 kohm pull-up to 3V3** and reads the
node with a Teensy ADC pin (9 slots + master outputs: use a 74HC4067 mux in front of one ADC pin, the same part the
surface uses). Use 1 % resistors. Voltage = 3.3 V x R / (R + 10 k):

| Module | ID resistor | Voltage | 12-bit ADC |
|---|---|---|---|
| blank plate / empty | open | 3.30 V | 4095 |
| `io-dual-trs` | 1 k | 0.30 V | 372 |
| `io-dual-mini` | 2.2 k | 0.60 V | 738 |
| `io-rca` | 3.3 k | 0.82 V | 1016 |
| `io-stereo-trs` | 4.7 k | 1.06 V | 1309 |
| `io-stereo-mini` | 6.8 k | 1.34 V | 1658 |
| `io-xlr` | 10 k | 1.65 V | 2048 |
| `io-dual-xlr` | 15 k | 1.98 V | 2457 |
| `io-trs-rca-combo` | 22 k | 2.27 V | 2815 |
| `out-trs-rca-combo` | 33 k | 2.53 V | 3143 |
| `out-xlr-pair` | 47 k | 2.72 V | 3377 |
| `out-booth` | 68 k | 2.88 V | 3570 |

Neighbouring steps are at least 190 counts (about 0.15 V) apart, far more than 1 % resistors move them. Decide with
thresholds halfway between steps. A module that does not match `spec.ioSlots` should be reported (wrong plate in a slot)
rather than silently mixed.

## 3. Module types

`IO_MODULES` in the catalog is the source of truth; this is the summary.

| Module | Direction | Connectors | Level | Phantom | Front end (candidates **[FLAG]**) | Approx. price (parts + PCB) |
|---|---|---|---|---|---|---|
| `io-dual-trs` | in, stereo | 2 x 6.3 mm TRS (Neutrik NMJ6HFD2, D-size) | +4 dBu pro | no | INA2137 receiver, diff driver | ~21 |
| `io-dual-mini` | in, stereo | 2 x 3.5 mm TS (Thonkiconn PJ398SM) | -10 dBV | no | op-amp buffer, diff driver | ~13 |
| `io-rca` | in, stereo | 2 x RCA | -10 dBV | no | buffer, diff driver | ~14 |
| `io-stereo-trs` | in, stereo | 1 x 6.3 mm stereo TRS | -10 dBV | no | buffer, diff driver | ~16 |
| `io-stereo-mini` | in, stereo | 1 x 3.5 mm stereo (SJ1-3533NG) | -10 dBV | no | buffer, diff driver | ~12 |
| `io-xlr` | in, mono (dual-mono into the channel) | 1 x XLR-F (NC3FD-L-1) | mic, 40 dB (20-60) | yes | THAT1510/1512, diff driver | ~25 |
| `io-dual-xlr` | in, stereo | 2 x XLR-F | mic, 40 dB | yes | 2 x THAT1512, diff driver | ~45 |
| `io-trs-rca-combo` | in, stereo, A/B | A = 2 x 6.3 mm, B = 2 x RCA | A +4 dBu (-12 dB pad), B -10 dBV | no | INA2137, buffer, relay (TQ2-5V), driver | ~40 |
| `out-trs-rca-combo` | out, master, selectable | 2 x 6.3 mm, 2 x RCA | +4 dBu / -10 dBV | no | driver, relay | ~35 |
| `out-xlr-pair` | out, master, balanced | 2 x XLR-M (NC3MD-L-1) | +4 dBu | no | DRV134 / THAT1646 | ~25 |
| `out-booth` | out, booth | 2 x RCA | -10 dBV | no | buffer | ~12 |
| `out-phones` | out, phones, **top panel** | 6.3 mm + 3.5 mm | headphones | no | TPA6120 / NJM4556 | ~22 |

**A/B select.** `io-trs-rca-combo` has both a 6.3 mm pair (A) and an RCA pair (B). The relay on the module switches
**after** the per-input pads, so both inputs land near -10 dBFS. SEL comes from the engine, which follows the surface
`inputSelect` button (the illuminated A/B button on each strip). Modules without a selector ignore SEL; the audio checks
note a bound A/B button that has no effect.

**Mono modules.** `io-xlr` carries one signal; the engine feeds it to both sides of a stereo channel ("dual-mono"). It uses one
codec input, so it leaves room for another channel.

**Rule of thumb for the codec inputs.** Sum of `codecPorts` over the modules <= the board's inputs (6 or 12). The checker
(`validateAudio`) errors if it is exceeded.

## 4. Power budget per module (typical, **[FLAG]** estimates)

| Module | +12 V | -12 V | +5 V | +48 V |
|---|---|---|---|---|
| line in (dual TRS / mini / RCA / stereo) | 8-12 mA | 8-12 mA | 0 | 0 |
| `io-xlr` | 10 mA | 10 mA | 0 | 10 mA |
| `io-dual-xlr` | 20 mA | 20 mA | 0 | 20 mA |
| `io-trs-rca-combo` (relay) | 16 mA | 16 mA | ~40 mA | 0 |
| `out-trs-rca-combo` (relay) | 14 mA | 14 mA | ~40 mA | 0 |
| `out-xlr-pair` | 12 mA | 12 mA | 0 | 0 |
| `out-booth` | 8 mA | 8 mA | 0 | 0 |
| `out-phones` (amp) | 30 mA | 30 mA | 0 | 0 |

Mixer-6 worst case: about 190 mA on each of +/-12 V, about 240 mA of relay coils on +5 V, 30 mA on +48 V; those fit the
power board rails below. Phantom is limited by the **module**: each mic channel gets 48 V through 6.8 kohm resistors
(about 10 mA short-circuit per mic).

## 5. Hot-swap: no

Power the mixer down before you plug or unplug a module. The IDC header carries +/-12 V, 5 V and **+48 V**: a header that
makes contact pin by pin while live can put the rails on the wrong pins, pop the codec inputs, or put 48 V on a signal pin.
The ID resistor is read at power-up (or on request), not as a live "plug detect". The case against a "yes": reliable
hot-swap needs sequenced connectors and rail switches nobody has designed here.

## 6. Master I/O and phones

The master outputs are **not slotted** in the sense of being swappable per channel: they occupy fixed slots after the
channel slots, but they use the same plate standard, so a different output module can be fitted:

- `out-trs-rca-combo`: master L/R on 6.3 mm or RCA (SEL selects; or drop the relay and drive both),
- `out-xlr-pair`: master L/R balanced on two male XLRs,
- `out-booth`: booth L/R on RCA, level = BOOTH knob,
- `out-phones`: on the **top panel** (a 6.3 mm and a 3.5 mm jack in parallel) next to the PHONES knob, like DJ mixers. The
  headphone amplifier sits on the power board side. **[FLAG]** amp part and thermal budget are open.

The engine outputs are 8 per codec: master L/R (shared by the combo and XLR modules), booth L/R, phones L/R, one spare pair.

## 7. Power board

Input: **USB-C PD sink** negotiating 15 V or 20 V (candidate: Adafruit 5991, HUSB238; avoid CH224K boards, reset loops
reported). Rails (**[FLAG]** candidate parts, nothing built):

| Rail | Budget | How |
|---|---|---|
| +5 V | 1.5 A | buck from the PD voltage: surface LEDs, Teensy(s), relay coils |
| +12 V / -12 V | 300 mA | buck to 12 V + inverting converter for -12 V, LC-filtered / LDO'd for the analog stages |
| +48 V | 60 mA | low-noise boost for phantom: about 10 mA per mic channel (4 mics = 40 mA) |

The surface (Pico or Teensy) is powered over its own USB for MIDI; the power board's 5 V rail powers the audio side and the
LED chain's return. Ground: AGND and DGND meet at one point at the power board.

## 8. What is deliberately open

- the 2-codec board (breadboard first),
- all front-end ICs (INA2137 vs THAT1246, THAT1646 vs DRV134, op-amps), the relay vs an analog switch (ADG1236 class),
- headphone amp, power board converters, -12 V and +48 V parts,
- the D-size flange outline, screw pattern and jack cut-out (check the Neutrik drawings),
- the RCA chassis jack (no part chosen), the Switchcraft 12A and Thonkiconn/Same Sky hole sizes,
- DAC full-scale output level.
