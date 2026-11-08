// Known-good parts. Plain typed data; currentMa is typical 3V3-rail draw per unit.
import type { McuId } from './types';

export interface McuPart {
  id: McuId;
  name: string;
  datasheet: string;
  usableGpio: number[];
  adcPins: number[];
  reserved: number[];
  budget3v3Ma: number;
  priceUsd: number;
  board: { w: number; l: number; height: number }; // mm, incl. USB connector / headers
  notes: string[];
}

export type PartCategory = 'analog' | 'button' | 'encoder' | 'mux' | 'led' | 'meter' | 'port';

/** What the player sees on top of the panel. All sizes in mm; w = x extent, h/l = y extent in the part's natural (rotation 0) orientation. */
export type CapShape = { shape: 'circle'; d: number } | { shape: 'rect'; w: number; h: number };
/** The hole to cut in the panel. 'slot' has rounded ends (fader travel). */
export type CutoutShape = { shape: 'circle'; d: number } | { shape: 'slot'; w: number; l: number } | { shape: 'rect'; w: number; h: number };

export interface Footprint {
  cap: CapShape; // knob / keycap / fader cap (for meters: one segment)
  cutout: CutoutShape; // for meters: one segment
  heightAbove: number; // top of the cap above the panel surface
  bodyDepth: number; // part body below the panel underside (incl. solder lugs)
  minPitch: number; // centre-to-centre distance to a same-type neighbour before fingers collide
  face?: 'rear'; // mounted on the rear wall instead of the top panel (default: top)
  segmentPitch?: number; // meters: centre-to-centre of segments along y
}

export interface Part {
  id: string;
  category: PartCategory;
  name: string;
  partNumber: string;
  datasheet: string;
  currentMa: number;
  priceUsd: number; // approx. single-unit price
  footprint?: Footprint; // absent for parts that live inside the enclosure
  wiring: string[]; // beginner notes
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const MCUS: Record<McuId, McuPart> = {
  'rp2040-pico': {
    id: 'rp2040-pico',
    name: 'Raspberry Pi Pico',
    datasheet: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf',
    usableGpio: [...range(0, 22), ...range(26, 28)],
    adcPins: [26, 27, 28], // ADC0..2 = GPIO26..28
    reserved: [23, 24, 25, 29], // SMPS mode, VBUS sense, LED, VSYS/3
    budget3v3Ma: 300,
    priceUsd: 4,
    board: { w: 21, l: 51, height: 12 },
    notes: ['Analog inputs only on GPIO26-28 (3 channels); use a 74HC4067 mux for more.', 'Power pots from 3V3(OUT) and AGND for the cleanest readings.'],
  },
  teensy41: {
    id: 'teensy41',
    name: 'PJRC Teensy 4.1',
    datasheet: 'https://www.pjrc.com/store/teensy41.html',
    usableGpio: range(0, 41),
    adcPins: [...range(14, 27), ...range(38, 41)],
    reserved: [],
    budget3v3Ma: 250,
    priceUsd: 32,
    board: { w: 18, l: 61, height: 12 },
    notes: ['Pins are 3.3 V only, not 5 V tolerant.', 'Pin 13 also drives the on-board LED.'],
  },
};

export const PARTS: Record<string, Part> = {
  'pot-b10k': {
    id: 'pot-b10k',
    category: 'analog',
    name: 'Rotary potentiometer 10k linear',
    partNumber: 'Alpha RV16AF-41-15R1-B10K',
    datasheet: 'https://www.alphapotentiometers.com/',
    currentMa: 0.33,
    priceUsd: 1.5,
    // RV16: 6 mm bushing in a 7 mm hole, ~15 mm knob, 15 mm shaft, 16 mm round body.
    footprint: { cap: { shape: 'circle', d: 15 }, cutout: { shape: 'circle', d: 7 }, heightAbove: 20, bodyDepth: 20, minPitch: 20 },
    wiring: ['Left pin -> GND, right pin -> 3V3, middle pin (wiper) -> analog pin.', 'Swap left/right if the knob works backwards.'],
  },
  'fader-60mm-b10k': {
    id: 'fader-60mm-b10k',
    category: 'analog',
    name: '60 mm slide potentiometer 10k linear',
    partNumber: 'Bourns PTA6043-2015CPB103',
    datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PTA.pdf',
    currentMa: 0.33,
    priceUsd: 4,
    // 60 mm travel: slot ~2.5 x 62 mm, cap ~10 x 20 mm.
    footprint: { cap: { shape: 'rect', w: 10, h: 20 }, cutout: { shape: 'slot', w: 2.5, l: 62 }, heightAbove: 15, bodyDepth: 12, minPitch: 16 },
    wiring: ['Outer pins -> GND and 3V3, middle pin (wiper) -> analog pin.', 'Swap the outer pins to flip direction.'],
  },
  'fader-45mm-b10k': {
    id: 'fader-45mm-b10k',
    category: 'analog',
    name: '45 mm slide potentiometer 10k linear',
    partNumber: 'Bourns PTA4543-2015CPB103',
    datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PTA.pdf',
    currentMa: 0.33,
    priceUsd: 3.5,
    // 45 mm travel: slot ~2.5 x 47 mm, same cap as the 60 mm.
    footprint: { cap: { shape: 'rect', w: 10, h: 20 }, cutout: { shape: 'slot', w: 2.5, l: 47 }, heightAbove: 15, bodyDepth: 12, minPitch: 16 },
    wiring: ['Outer pins -> GND and 3V3, middle pin (wiper) -> analog pin.', 'Swap the outer pins to flip direction.'],
  },
  'pot-b10k-detent': {
    id: 'pot-b10k-detent',
    category: 'analog',
    name: 'Rotary potentiometer 10k linear, centre detent',
    partNumber: 'Alpha RV16AF-41-15R1-B10K, centre-detent version', // check the exact suffix in the shop: search "RV16 centre detent 10k linear"
    datasheet: 'https://www.alphapotentiometers.com/',
    currentMa: 0.33,
    priceUsd: 2.2,
    // Same mounting as the RV16. The click at 12 o'clock marks neutral: EQ flat, filter off, pan centred.
    footprint: { cap: { shape: 'circle', d: 15 }, cutout: { shape: 'circle', d: 7 }, heightAbove: 20, bodyDepth: 20, minPitch: 20 },
    wiring: ['Left pin -> GND, right pin -> 3V3, middle pin (wiper) -> analog pin.', 'The detent sits at the electrical centre (about 64 of 127).'],
  },
  'button-tact-6mm': {
    id: 'button-tact-6mm',
    category: 'button',
    name: '6 mm tactile switch',
    partNumber: 'Omron B3FS-1000P',
    datasheet: 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf',
    currentMa: 0.07,
    priceUsd: 0.2,
    // 6x6 mm switch with a 3.5 mm plunger poking through a 6.5 mm hole under an 8 mm cap.
    footprint: { cap: { shape: 'circle', d: 8 }, cutout: { shape: 'circle', d: 6.5 }, heightAbove: 5, bodyDepth: 6, minPitch: 12 },
    wiring: ['One leg -> GPIO, opposite leg -> GND. No resistor needed: the internal pull-up is enabled.'],
  },
  'button-led-12mm': {
    id: 'button-led-12mm',
    category: 'button',
    name: '12 mm illuminated tactile button (RGB)',
    partNumber: 'Omron B3F-4000 + B32-1010 clear cap + SK6812 MINI-E',
    datasheet: 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf',
    currentMa: 0.07,
    priceUsd: 1.2,
    // 12x12 tact switch with a clear round cap; one SK6812 MINI-E (3.2 x 2.8 mm, reverse-mount) soldered beside it lights the cap.
    // The LED is one link of the WS2812 chain (set ButtonControl.led.index); it is powered from 5 V, not 3V3.
    footprint: { cap: { shape: 'circle', d: 13 }, cutout: { shape: 'circle', d: 13.5 }, heightAbove: 8, bodyDepth: 8, minPitch: 16 },
    wiring: [
      'Switch: one leg -> GPIO (or a digital mux channel), opposite leg -> GND. Internal pull-up, no resistor.',
      'LED: DIN <- previous LED in the chain, DOUT -> next LED, VDD -> 5 V (VBUS), GND -> GND. Add a 100 nF capacitor across VDD/GND next to it.',
    ],
  },
  'button-cherry-mx': {
    id: 'button-cherry-mx',
    category: 'button',
    name: 'Cherry MX style key switch',
    partNumber: 'Cherry MX1A-E1NW (MX Red)',
    datasheet: 'https://www.cherrymx.de/en/mx-original/mx-red.html',
    currentMa: 0.07,
    priceUsd: 1,
    // Standard 14 x 14 mm plate cutout, 18 mm keycap, 19.05 mm key pitch.
    footprint: { cap: { shape: 'rect', w: 18, h: 18 }, cutout: { shape: 'rect', w: 14, h: 14 }, heightAbove: 18, bodyDepth: 8, minPitch: 19.05 },
    wiring: ['One contact -> GPIO, other contact -> GND. Polarity does not matter.'],
  },
  'button-encoder-push': {
    id: 'button-encoder-push',
    category: 'button',
    name: 'Push switch inside an encoder',
    partNumber: '(part of the push encoder)',
    datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PEC11R.pdf',
    currentMa: 0.07,
    priceUsd: 0,
    wiring: ['The two small switch pins on the encoder: one -> GPIO (or a digital mux channel), other -> GND.'],
  },
  'encoder-ec11': {
    id: 'encoder-ec11',
    category: 'encoder',
    name: 'Rotary encoder with detents, 20 PPR',
    partNumber: 'Alps EC11E15244G1',
    datasheet: 'https://tech.alpsalpine.com/e/products/detail/EC11E15244G1/',
    currentMa: 0.14,
    priceUsd: 1.2,
    // EC11: 7 mm bushing hole, 14 mm knob.
    footprint: { cap: { shape: 'circle', d: 14 }, cutout: { shape: 'circle', d: 7 }, heightAbove: 20, bodyDepth: 14, minPitch: 18 },
    wiring: ['Middle pin of the three (C) -> GND, outer pins A and B -> two GPIOs.', 'If it counts backwards, swap A and B.'],
  },
  'encoder-ec11-push': {
    id: 'encoder-ec11-push',
    category: 'encoder',
    name: 'Rotary encoder with push switch, 24 PPR',
    partNumber: 'Bourns PEC11R-4215F-S0024',
    datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PEC11R.pdf',
    currentMa: 0.21,
    priceUsd: 1.8,
    // Same mounting as the EC11. The push switch is its own ButtonControl (part button-encoder-push); it has no panel footprint.
    footprint: { cap: { shape: 'circle', d: 14 }, cutout: { shape: 'circle', d: 7 }, heightAbove: 20, bodyDepth: 14, minPitch: 18 },
    wiring: ['Three pins on one side: middle (C) -> GND, outer A and B -> two GPIOs.', 'Two pins on the other side are the push switch: add a button control for it.'],
  },
  'meter-led-bar': {
    id: 'meter-led-bar',
    category: 'meter',
    name: 'LED level meter segment (per LED)',
    partNumber: 'SK6812 MINI-E (3.2 x 2.8 mm) at 5 mm pitch',
    datasheet: 'https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf',
    currentMa: 0,
    priceUsd: 0.15, // per segment
    // One window per segment is merged into a single slot behind a diffuser strip; footprint is per segment (5 mm pitch).
    footprint: { cap: { shape: 'rect', w: 6, h: 5 }, cutout: { shape: 'rect', w: 4.5, h: 5 }, heightAbove: 1, bodyDepth: 5, minPitch: 6, segmentPitch: 5 },
    wiring: ['Every segment is one LED in the WS2812 chain: DIN <- previous, DOUT -> next, VDD -> 5 V, GND -> GND.', 'Solder the segments on a strip or perfboard at 5 mm pitch, top segment first in the chain.'],
  },
  'led-ws2812': {
    id: 'led-ws2812',
    category: 'led',
    name: 'Addressable RGB LED chain',
    partNumber: 'WS2812B-2020 / SK6812 MINI-E',
    datasheet: 'https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf',
    currentMa: 0,
    priceUsd: 0.15,
    wiring: [
      'GPIO -> 330 ohm resistor -> DIN of LED 0. DOUT of each LED -> DIN of the next.',
      'LEDs run on 5 V (VBUS), data from the Pico is 3.3 V: use a 74AHCT125 level shifter on the data line for reliability.',
      'Add a 1000 uF capacitor across 5 V / GND near the first LED.',
    ],
  },
  'midi-trs-a': {
    id: 'midi-trs-a',
    category: 'port',
    name: '3.5 mm TRS MIDI jack (Type A)',
    partNumber: 'CUI SJ1-3523N',
    datasheet: 'https://www.cuidevices.com/product/resource/sj1-352x-series.pdf',
    currentMa: 0,
    priceUsd: 1.2,
    // Panel-mount 3.5 mm stereo jack on the REAR wall: 6.2 mm hole, ~10 mm nut.
    footprint: { cap: { shape: 'circle', d: 10 }, cutout: { shape: 'circle', d: 6.2 }, heightAbove: 4, bodyDepth: 14, minPitch: 14, face: 'rear' },
    wiring: [
      'Type A: Tip = DIN pin 5, Ring = DIN pin 4, Sleeve = shield/GND.',
      'Out (3.3 V): 3V3 -> 220 ohm -> Ring; UART TX GPIO -> 220 ohm -> Tip. About 5 mA flows when TX is low.',
      'In (optional): Tip -> 220 ohm -> opto LED anode, Ring -> LED cathode, 1N4148 across the LED the other way. Use an H11L1 (works on 3.3 V) or a 6N138 (needs 5 V and a pull-up to 3V3); opto output -> UART RX with a pull-up to 3V3.',
    ],
  },
  'midi-din5': {
    id: 'midi-din5',
    category: 'port',
    name: '5-pin DIN MIDI socket',
    partNumber: 'CUI SDS-50J',
    datasheet: 'https://www.cuidevices.com/product/resource/sds-50j.pdf',
    currentMa: 0,
    priceUsd: 1.5,
    // 15.5 mm hole plus two screws; flange ~20 mm.
    footprint: { cap: { shape: 'circle', d: 20 }, cutout: { shape: 'circle', d: 15.5 }, heightAbove: 2, bodyDepth: 18, minPitch: 25, face: 'rear' },
    wiring: [
      'Out: DIN pin 4 -> 220 ohm -> 3V3, DIN pin 5 -> 220 ohm -> UART TX GPIO, DIN pin 2 -> GND (shield).',
      'In (optional): pin 4 -> 220 ohm -> opto LED anode, pin 5 -> LED cathode, 1N4148 across the LED the other way; H11L1 (3.3 V) or 6N138 (5 V). Opto output -> UART RX with a pull-up to 3V3.',
    ],
  },
  'usb-micro-b': {
    id: 'usb-micro-b',
    category: 'port',
    name: 'USB opening in the rear wall',
    partNumber: '(on the board)',
    datasheet: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf',
    currentMa: 0,
    priceUsd: 0,
    // Opening for a micro-B plug with some play (overmould ~11 x 7 mm).
    footprint: { cap: { shape: 'rect', w: 11, h: 7 }, cutout: { shape: 'rect', w: 11, h: 7 }, heightAbove: 0, bodyDepth: 0, minPitch: 12, face: 'rear' },
    wiring: ['No wiring: the connector is on the Pico / Teensy. Line the opening up with it.'],
  },
  'mux-74hc4067': {
    id: 'mux-74hc4067',
    category: 'mux',
    name: '16-channel analog/digital multiplexer breakout',
    partNumber: 'TI CD74HC4067',
    datasheet: 'https://www.ti.com/lit/ds/symlink/cd74hc4067.pdf',
    currentMa: 0.1,
    priceUsd: 3,
    wiring: [
      'VCC -> 3V3, GND -> GND, EN -> GND, SIG -> ADC pin (analog) or any GPIO (digital buttons), S0-S3 -> the shared select bus.',
      'Each pot wiper goes to a channel pin C0-C15. For buttons: one leg to a channel pin, other leg to GND.',
    ],
  },
};

/** RP2040 ADC channel for a GPIO (26 -> 0). */
export const adcChannel = (gpio: number): number => gpio - 26;
