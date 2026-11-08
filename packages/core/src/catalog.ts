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
  notes: string[];
}

export type PartCategory = 'analog' | 'button' | 'encoder' | 'mux';

export interface Part {
  id: string;
  category: PartCategory;
  name: string;
  partNumber: string;
  datasheet: string;
  currentMa: number;
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
    wiring: ['Left pin -> GND, right pin -> 3V3, middle pin (wiper) -> analog pin.', 'Swap left/right if the knob works backwards.'],
  },
  'fader-60mm-b10k': {
    id: 'fader-60mm-b10k',
    category: 'analog',
    name: '60 mm slide potentiometer 10k linear',
    partNumber: 'Bourns PTA6043-2015CPB103',
    datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PTA.pdf',
    currentMa: 0.33,
    wiring: ['Outer pins -> GND and 3V3, middle pin (wiper) -> analog pin.', 'Swap the outer pins to flip direction.'],
  },
  'button-tact-6mm': {
    id: 'button-tact-6mm',
    category: 'button',
    name: '6 mm tactile switch',
    partNumber: 'Omron B3F-1000',
    datasheet: 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf',
    currentMa: 0.07,
    wiring: ['One leg -> GPIO, opposite leg -> GND. No resistor needed: the internal pull-up is enabled.'],
  },
  'button-cherry-mx': {
    id: 'button-cherry-mx',
    category: 'button',
    name: 'Cherry MX style key switch',
    partNumber: 'Cherry MX1A-E1NW (MX Red)',
    datasheet: 'https://www.cherrymx.de/en/mx-original/mx-red.html',
    currentMa: 0.07,
    wiring: ['One contact -> GPIO, other contact -> GND. Polarity does not matter.'],
  },
  'encoder-ec11': {
    id: 'encoder-ec11',
    category: 'encoder',
    name: 'Rotary encoder with detents, 20 PPR',
    partNumber: 'Alps EC11E15244G1',
    datasheet: 'https://tech.alpsalpine.com/e/products/detail/EC11E15244G1/',
    currentMa: 0.14,
    wiring: ['Middle pin of the three (C) -> GND, outer pins A and B -> two GPIOs.', 'If it counts backwards, swap A and B.'],
  },
  'mux-74hc4067': {
    id: 'mux-74hc4067',
    category: 'mux',
    name: '16-channel analog multiplexer breakout',
    partNumber: 'TI CD74HC4067',
    datasheet: 'https://www.ti.com/lit/ds/symlink/cd74hc4067.pdf',
    currentMa: 0.1,
    wiring: ['VCC -> 3V3, GND -> GND, EN -> GND, SIG -> ADC pin, S0-S3 -> four GPIOs.', 'Each pot wiper goes to a channel pin C0-C15.'],
  },
};

/** RP2040 ADC channel for a GPIO (26 -> 0). */
export const adcChannel = (gpio: number): number => gpio - 26;
