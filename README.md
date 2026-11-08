# kont.rolla

Design, emulate, and build custom MIDI controllers from known-good parts.

- `packages/core`: parts catalog, device spec, validation, config blob, behavioural model, Teensy sketch generator
- `packages/emulator`: RP2040 instruction-level emulation (rp2040js) running the real firmware
- `firmware/rp2040`: generic config-driven USB MIDI firmware (pico-sdk + TinyUSB)
- `apps/web`: design wizard, virtual front panel, MIDI monitor
- `apps/helper`: localhost bridge exposing the emulated device as a virtual MIDI port

Contracts: [docs/CONTRACTS.md](docs/CONTRACTS.md)
