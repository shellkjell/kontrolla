# Third-party notices

kont.rolla is MIT licensed (see `LICENSE`). It ships or bundles the following third-party code.

| Component | Where | Licence |
|---|---|---|
| [Raspberry Pi Pico SDK](https://github.com/raspberrypi/pico-sdk) 2.3.1 | linked into `firmware/rp2040/dist/*` | BSD-3-Clause, Copyright (c) 2020 Raspberry Pi (Trading) Ltd. |
| [TinyUSB](https://github.com/hathach/tinyusb) | linked into `firmware/rp2040/dist/*` | MIT, Copyright (c) 2018 Ha Thach (tinyusb.org) |
| RP2040 bootrom (from [pico-bootrom](https://github.com/raspberrypi/pico-bootrom) via rp2040js) | `packages/emulator/src/bootrom.ts` | BSD-3-Clause, Copyright (c) 2020 Raspberry Pi (Trading) Ltd. |
| [rp2040js](https://github.com/wokwi/rp2040js) | bundled into the web app | MIT, Copyright (c) 2021 Uri Shaked |
| [three.js](https://github.com/mrdoob/three.js) | bundled into the web app | MIT, Copyright (c) 2010-2026 three.js authors |
| [React](https://github.com/facebook/react) | bundled into the web app | MIT, Copyright (c) Meta Platforms, Inc. and affiliates |
| [@julusian/midi](https://github.com/Julusian/node-midi) | `apps/helper` dependency | MIT |
| Web fonts | bundled into the web app | SIL Open Font License 1.1 (see each font package) |

BSD-3-Clause terms for the Pico SDK and bootrom:

> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
