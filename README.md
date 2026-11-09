# kont.rolla

Design a MIDI controller, play it in the browser, then build it.

You pick known-good parts (pots, faders, buttons, encoders, LED buttons and meters, muxes), lay them out on a panel, and kont.rolla works out the pins, wiring, parts list, enclosure and firmware. Before you buy anything you can play the device on a virtual front panel and watch the MIDI it sends.

For a Raspberry Pi Pico design the thing you play is the actual firmware. The same compiled binary that you will flash runs instruction by instruction in [rp2040js](https://github.com/wokwi/rp2040js) inside a Web Worker, enumerates as USB MIDI and drives its WS2812 LEDs, which the emulator decodes from the waveform on the data pin. Teensy 4.1 designs run on a behavioural model instead, and the UI says so.

Live: <https://kontrolla.haak.tech>

## What's in it

- **Design**: parts catalog with real footprints, automatic pin and mux allocation, electrical checks (pin conflicts, ADC pins, USB power budget for LEDs, scan time), a 2D panel editor in millimetres with sketching, groups for channel strips, and a 3D model of the enclosure.
- **Test**: virtual front panel, MIDI monitor, adjustable pot noise and contact bounce, a fake DAW that drives meters and echoes button LEDs back, and a one-click self-test of every control.
- **Build**: parts list with prices and shop links, wiring table, step-by-step build guide, a flashable `.uf2` (generic firmware + your config), an Arduino sketch for Teensy, an STL of the enclosure and a 1:1 drill template you can print and glue to cardboard.
- **Audio mixers** (experimental): the Portable Mixer presets add swappable per-channel rear I/O modules and an audio engine on a Teensy 4.1 with CS42448 codecs. You can listen to it in the browser. See the caveats below.

## Status

None of this has been run on real hardware yet. Specifically:

- The RP2040 firmware is tested against a TypeScript reference model with byte-for-byte differential tests in the emulator, not on a physical Pico.
- The generated Teensy sketches (controller and audio engine) have never been compiled.
- The one-codec audio engine (3 stereo channels) uses a known-working combination. The two-codec version (6 stereo channels) is unproven: the [only public attempt](https://forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526/) got sound from one codec only. Breadboard it before designing a PCB.
- Part dimensions, some part numbers and the audio front-end ICs are flagged in the catalog and in [docs/IO-SLOTS.md](docs/IO-SLOTS.md) where unverified.

If you build one, please open an issue with what worked and what didn't.

## Running it

Needs [Bun](https://bun.sh).

```sh
bun install
cd apps/web && bunx vite
```

Optional: `bun apps/helper/src/main.ts` exposes the emulated device as a virtual MIDI port called "kont.rolla" (macOS/Linux), so you can play it into your DAW.

Tests: `bun test` from the repo root.

The firmware binaries in `firmware/rp2040/dist` are committed so nobody needs an ARM toolchain to use the app. To rebuild them: `firmware/rp2040/setup-toolchain.sh` (macOS arm64) then `firmware/rp2040/build.sh`.

## Layout

| Path | |
|---|---|
| `packages/core` | types, catalog, allocation, validation, config blob, reference model, layout, Teensy sketch |
| `packages/emulator` | rp2040js rig: USB MIDI host, PIO clocking, UART, Web Worker runtime |
| `packages/enclosure` | three.js model, STL export, drill template |
| `packages/audio` | mixer DSP model, AudioWorklet, demo sources, Teensy audio engine sketch |
| `firmware/rp2040` | the one generic firmware (pico-sdk + TinyUSB) |
| `apps/web` | the app |
| `apps/helper` | WebSocket to virtual MIDI port bridge |

The rules the firmware and the model both follow are in [docs/CONTRACTS.md](docs/CONTRACTS.md); the audio engine's in [docs/AUDIO.md](docs/AUDIO.md).

## Licence

MIT. Third-party code and its licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The USB IDs (VID 0x1209, PID 0x0001) are the pid.codes test pair and are only fine for personal builds.
