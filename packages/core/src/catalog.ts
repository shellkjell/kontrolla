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

export type PartCategory = 'analog' | 'button' | 'encoder' | 'mux' | 'led' | 'meter' | 'port' | 'connector';

/** 'proven' = built and working by someone (cite it); 'experimental' = candidate or unproven, check before you build a PCB. */
export type Maturity = 'proven' | 'experimental';

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
  holes?: { dx: number; dy: number; d: number }[]; // extra round holes (screws) relative to the centre, dy down
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
  maturity?: Maturity; // default 'proven'
  maturityNote?: string; // why, when experimental (or the source, when proven)
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
      'Out (3.3 V, MIDI 1.0 electrical spec update CA-033): 3V3 -> 33 ohm 0.5 W -> Ring (DIN pin 4); UART TX GPIO -> 10 ohm -> Tip (DIN pin 5). Use 220 ohm + 220 ohm instead only if the output is driven from 5 V. About 5 mA flows when TX is low.',
      'Sleeve (DIN pin 2) -> GND on the transmitting side only; never ground it on a MIDI in.',
      'In (optional; a 3.3 V input needs no changes): Tip -> 220 ohm -> opto LED anode, Ring -> LED cathode, 1N4148 across the LED the other way. Use an H11L1 (works on 3.3 V) or a 6N138 (needs 5 V and a pull-up to 3V3); opto output -> UART RX with a pull-up to 3V3.',
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
      'Out (3.3 V, MIDI 1.0 spec update CA-033): DIN pin 4 -> 33 ohm 0.5 W -> 3V3, DIN pin 5 -> 10 ohm -> UART TX GPIO, DIN pin 2 -> GND. With a 5 V driver use 220 ohm + 220 ohm.',
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
  'io-slot': {
    id: 'io-slot',
    category: 'port',
    name: 'I/O slot opening in the rear wall (kont.rolla I/O slot standard)',
    partNumber: '(printed rear wall)',
    datasheet: 'docs/IO-SLOTS.md',
    currentMa: 0,
    priceUsd: 0,
    // 32 x 66 mm opening: two Neutrik D-size flanges (26 x 31 mm) stacked with a 4 mm gap. Module plate screws (M3) sit 3.5 mm above and below.
    footprint: {
      cap: { shape: 'rect', w: 32, h: 80 },
      cutout: { shape: 'rect', w: 32, h: 66 },
      heightAbove: 0,
      bodyDepth: 0,
      minPitch: 36,
      face: 'rear',
      holes: [{ dx: 0, dy: -36.5, d: 3.2 }, { dx: 0, dy: 36.5, d: 3.2 }],
    },
    wiring: ['Bolt a module plate in the opening with two M3 screws (top and bottom). An empty slot gets a blank plate.'],
  },
  'usb-c-power': {
    id: 'usb-c-power',
    category: 'port',
    name: 'USB-C power opening in the rear wall',
    partNumber: '(on the power board)',
    datasheet: 'docs/IO-SLOTS.md',
    currentMa: 0,
    priceUsd: 0,
    footprint: { cap: { shape: 'rect', w: 10, h: 4 }, cutout: { shape: 'rect', w: 10, h: 4 }, heightAbove: 0, bodyDepth: 0, minPitch: 12, face: 'rear' },
    wiring: ['No wiring: the USB-C receptacle is on the power board. Line the opening up with it.'],
  },
  'phones-jack-63': {
    id: 'phones-jack-63',
    category: 'connector',
    name: '6.3 mm stereo phones jack (top panel)',
    partNumber: 'Switchcraft 12A',
    datasheet: 'https://www.switchcraft.com/',
    currentMa: 0,
    priceUsd: 3,
    maturity: 'experimental',
    maturityNote: 'Part number and 9.5 mm (3/8") hole are from memory of the Switchcraft 1/4" panel-jack family; check the drawing before drilling.',
    footprint: { cap: { shape: 'circle', d: 14 }, cutout: { shape: 'circle', d: 9.5 }, heightAbove: 3, bodyDepth: 25, minPitch: 20 },
    wiring: ['Tip = left, Ring = right, Sleeve = ground, from the phones amplifier (see docs/IO-SLOTS.md, master I/O).'],
  },
  'phones-jack-35': {
    id: 'phones-jack-35',
    category: 'connector',
    name: '3.5 mm stereo phones jack (top panel)',
    partNumber: 'Same Sky (CUI) SJ1-3533NG',
    datasheet: 'https://www.sameskydevices.com/product/resource/sj1-353x-series.pdf',
    currentMa: 0,
    priceUsd: 1,
    maturity: 'experimental',
    maturityNote: '6.2 mm hole assumed from the SJ1-352x/353x series; check the datasheet drawing.',
    footprint: { cap: { shape: 'circle', d: 10 }, cutout: { shape: 'circle', d: 6.2 }, heightAbove: 2, bodyDepth: 14, minPitch: 14 },
    wiring: ['Tip = left, Ring = right, Sleeve = ground, in parallel with the 6.3 mm phones jack.'],
  },
  'conn-xlr-f': {
    id: 'conn-xlr-f',
    category: 'connector',
    name: 'XLR 3-pin female panel socket (D-size)',
    partNumber: 'Neutrik NC3FD-L-1',
    datasheet: 'https://www.neutrik.com/en/product/nc3fd-l-1',
    currentMa: 0,
    priceUsd: 4.5,
    maturity: 'experimental',
    maturityNote: 'Neutrik datasheet: D-size, 24 mm round panel cut-out, M3 countersunk holes, panel 1-3 mm. The 26 x 31 mm flange and the diagonal 19 x 26 mm hole pattern are NOT in the datasheet text; they come from the D-series footprint (NJ3FP6C datasheet: "31 x 26 mm") and a catalogue listing "mounting hole 19 26". Check Neutrik drawing before cutting metal.',
    footprint: { cap: { shape: 'rect', w: 26, h: 31 }, cutout: { shape: 'circle', d: 24 }, heightAbove: 2, bodyDepth: 30, minPitch: 31, face: 'rear', holes: [{ dx: -9.5, dy: -13, d: 3.2 }, { dx: 9.5, dy: 13, d: 3.2 }] },
    wiring: ['Pin 1 = shield/ground, pin 2 = hot (+), pin 3 = cold (-). Solder cups.'],
  },
  'conn-xlr-m': {
    id: 'conn-xlr-m',
    category: 'connector',
    name: 'XLR 3-pin male panel plug (D-size)',
    partNumber: 'Neutrik NC3MD-L-1',
    datasheet: 'https://www.neutrik.com/en/product/nc3md-l-1',
    currentMa: 0,
    priceUsd: 4.5,
    maturity: 'experimental',
    maturityNote: 'Same D-size cut-out as the female; see conn-xlr-f for what is and is not verified.',
    footprint: { cap: { shape: 'rect', w: 26, h: 31 }, cutout: { shape: 'circle', d: 24 }, heightAbove: 2, bodyDepth: 30, minPitch: 31, face: 'rear', holes: [{ dx: -9.5, dy: -13, d: 3.2 }, { dx: 9.5, dy: 13, d: 3.2 }] },
    wiring: ['Pin 1 = shield/ground, pin 2 = hot (+), pin 3 = cold (-). Solder cups.'],
  },
  'conn-trs-63-d': {
    id: 'conn-trs-63-d',
    category: 'connector',
    name: '6.3 mm TRS jack, D-size flange',
    partNumber: 'Neutrik NMJ6HFD2',
    datasheet: 'https://www.neutrik.com/en/product/nmj6hfd2',
    currentMa: 0,
    priceUsd: 4.5,
    maturity: 'experimental',
    maturityNote: 'Assumed to share the XLR D-size cut-out (Neutrik says the D jacks are "dimensionally compatible with D Series (31 x 26 mm)"); the cut-out diameter for a jack is not checked.',
    footprint: { cap: { shape: 'rect', w: 26, h: 31 }, cutout: { shape: 'circle', d: 24 }, heightAbove: 2, bodyDepth: 28, minPitch: 31, face: 'rear', holes: [{ dx: -9.5, dy: -13, d: 3.2 }, { dx: 9.5, dy: 13, d: 3.2 }] },
    wiring: ['Tip = hot, Ring = cold (balanced) or right (stereo), Sleeve = ground.'],
  },
  'conn-trs-63-panel': {
    id: 'conn-trs-63-panel',
    category: 'connector',
    name: '6.3 mm TRS panel jack (compact)',
    partNumber: 'Switchcraft 12A',
    datasheet: 'https://www.switchcraft.com/',
    currentMa: 0,
    priceUsd: 3,
    maturity: 'experimental',
    maturityNote: 'Part number and 9.5 mm hole assumed; used where two jacks must sit side by side in one 32 mm slot.',
    footprint: { cap: { shape: 'circle', d: 14 }, cutout: { shape: 'circle', d: 9.5 }, heightAbove: 3, bodyDepth: 25, minPitch: 16, face: 'rear' },
    wiring: ['Tip = hot, Ring = cold (balanced) or right (stereo), Sleeve = ground.'],
  },
  'conn-mini-mono': {
    id: 'conn-mini-mono',
    category: 'connector',
    name: '3.5 mm mono (TS) panel jack',
    partNumber: 'Thonk Thonkiconn PJ398SM',
    datasheet: 'https://www.thonk.co.uk/shop/thonkiconn/',
    currentMa: 0,
    priceUsd: 0.5,
    maturity: 'experimental',
    maturityNote: '6 mm hole is the usual Thonkiconn panel hole; it is a eurorack-grade jack, check you like its retention force.',
    footprint: { cap: { shape: 'circle', d: 9 }, cutout: { shape: 'circle', d: 6 }, heightAbove: 2, bodyDepth: 12, minPitch: 12, face: 'rear' },
    wiring: ['Tip = signal, Sleeve = ground.'],
  },
  'conn-mini-stereo': {
    id: 'conn-mini-stereo',
    category: 'connector',
    name: '3.5 mm stereo (TRS) panel jack',
    partNumber: 'Same Sky (CUI) SJ1-3533NG',
    datasheet: 'https://www.sameskydevices.com/product/resource/sj1-353x-series.pdf',
    currentMa: 0,
    priceUsd: 1,
    maturity: 'experimental',
    maturityNote: '6.2 mm hole assumed from the SJ1-352x/353x series; check the datasheet drawing.',
    footprint: { cap: { shape: 'circle', d: 10 }, cutout: { shape: 'circle', d: 6.2 }, heightAbove: 2, bodyDepth: 14, minPitch: 14, face: 'rear' },
    wiring: ['Tip = left, Ring = right, Sleeve = ground.'],
  },
  'conn-rca': {
    id: 'conn-rca',
    category: 'connector',
    name: 'RCA chassis jack',
    partNumber: 'Chassis-mount RCA jack, 9.5 mm hole (exact part not chosen)',
    datasheet: 'docs/IO-SLOTS.md',
    currentMa: 0,
    priceUsd: 1.5,
    maturity: 'experimental',
    maturityNote: 'No specific part verified. The Same Sky (ex CUI) RCJ-0xx jacks I checked are PCB right-angle types without a published panel hole. Pick any chassis RCA with a 9.5 mm hole, or a Neutrik D-size RCA, and update the footprint.',
    footprint: { cap: { shape: 'circle', d: 12 }, cutout: { shape: 'circle', d: 9.5 }, heightAbove: 8, bodyDepth: 15, minPitch: 14, face: 'rear' },
    wiring: ['Centre pin = signal, outer ring = ground.'],
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

// ---- Audio: engine boards, swappable I/O modules, power board (spec.audio / spec.ioSlots) -------------------------------
// Everything with maturity 'experimental' is a candidate, or a number nobody has measured. See docs/IO-SLOTS.md and docs/AUDIO.md.

export interface BomLine {
  name: string;
  partNumber: string;
  qty: number;
  priceUsd: number; // approx., per unit
  notes?: string;
  maturity?: Maturity;
}

export interface AudioBoardPin {
  signal: string;
  teensyPin: number;
  note?: string;
}

export interface AudioBoard {
  id: string;
  name: string;
  maturity: Maturity;
  maturityNote: string;
  mcu: 'teensy41';
  codecs: 1 | 2;
  inputs: number; // analog ADC inputs (6 per CS42448)
  outputs: number; // analog DAC outputs (8 per CS42448)
  stereoChannels: number; // inputs / 2
  sampleRate: number;
  bitDepth: number; // Teensy Audio Library is 16-bit
  bom: BomLine[];
  pins: AudioBoardPin[];
  notes: string[];
  sources: string[];
}

const CS42448_SOURCES = [
  'https://forum.pjrc.com/index.php?threads/teensy-4-1-to-handle-2-x-cs42448-possible.75526/',
  'https://www.pjrc.com/teensy/td_libs_Audio.html',
];
const CS42448_BOM: BomLine[] = [
  { name: 'Teensy 4.1', partNumber: 'PJRC Teensy 4.1 (no Ethernet)', qty: 1, priceUsd: 32 },
  {
    name: 'CS42448 codec board',
    partNumber: 'Cirrus CS42448 on a breakout / custom board',
    qty: 1,
    priceUsd: 35,
    maturity: 'experimental',
    notes: 'No off-the-shelf breakout verified. Price is a placeholder. Needs VA 5 V, VD/VLC 3.3 V, 12.288 MHz-class MCLK from the Teensy, I2C control.',
  },
];

export const AUDIO_BOARDS: Record<string, AudioBoard> = {
  'teensy41-cs42448': {
    id: 'teensy41-cs42448',
    name: 'Teensy 4.1 + 1 x CS42448 (6 in / 8 out)',
    maturity: 'proven',
    maturityNote: 'One CS42448 on a Teensy 4.1 over TDM is supported by the Teensy Audio Library (AudioControlCS42448, AudioInputTDM / AudioOutputTDM) and reported working on the PJRC forum.',
    mcu: 'teensy41',
    codecs: 1,
    inputs: 6,
    outputs: 8,
    stereoChannels: 3,
    sampleRate: 44100,
    bitDepth: 16,
    bom: CS42448_BOM,
    pins: [
      { signal: 'TDM MCLK', teensyPin: 23 },
      { signal: 'TDM BCLK', teensyPin: 21 },
      { signal: 'TDM LRCLK (frame sync)', teensyPin: 20 },
      { signal: 'TDM data out (to codec DAC)', teensyPin: 7 },
      { signal: 'TDM data in (from codec ADC)', teensyPin: 8 },
      { signal: 'I2C SDA (codec control)', teensyPin: 18 },
      { signal: 'I2C SCL (codec control)', teensyPin: 19 },
      { signal: 'Codec RESET (active low)', teensyPin: 22, note: 'any free pin; 22 is a suggestion' },
      { signal: 'UART RX from the surface (MIDI)', teensyPin: 0, note: 'Serial1' },
      { signal: 'UART TX to the surface (MIDI)', teensyPin: 1, note: 'Serial1' },
    ],
    notes: [
      'Pin numbers follow the Teensy 4.x Audio Library TDM pinout; verify against the library documentation before you route a PCB.',
      '16-bit / 44.1 kHz is the Teensy Audio Library format, even though the codec itself is 24-bit.',
      'CS42448 ADC full scale is taken as about 1 Vrms differential at VA = 5 V (design brief). The DAC full-scale output is NOT verified: check the datasheet before you size the output stage.',
      '6 inputs = 3 stereo channels; 8 outputs = master + booth + phones + one spare stereo pair.',
    ],
    sources: CS42448_SOURCES,
  },
  'teensy41-cs42448x2': {
    id: 'teensy41-cs42448x2',
    name: 'Teensy 4.1 + 2 x CS42448 (12 in / 16 out, TDM + TDM2)',
    maturity: 'experimental',
    maturityNote: 'UNPROVEN. In the one PJRC forum attempt (2 codecs on TDM and TDM2) only the first codec produced sound. Breadboard both codecs before you design a PCB.',
    mcu: 'teensy41',
    codecs: 2,
    inputs: 12,
    outputs: 16,
    stereoChannels: 6,
    sampleRate: 44100,
    bitDepth: 16,
    bom: [CS42448_BOM[0]!, { ...CS42448_BOM[1]!, qty: 2 }],
    pins: [
      { signal: 'TDM MCLK (codec 1)', teensyPin: 23 },
      { signal: 'TDM BCLK (codec 1)', teensyPin: 21 },
      { signal: 'TDM LRCLK (codec 1)', teensyPin: 20 },
      { signal: 'TDM data out (codec 1)', teensyPin: 7 },
      { signal: 'TDM data in (codec 1)', teensyPin: 8 },
      { signal: 'TDM2 MCLK (codec 2)', teensyPin: 33 },
      { signal: 'TDM2 BCLK (codec 2)', teensyPin: 4 },
      { signal: 'TDM2 LRCLK (codec 2)', teensyPin: 3 },
      { signal: 'TDM2 data out (codec 2)', teensyPin: 2 },
      { signal: 'TDM2 data in (codec 2)', teensyPin: 5 },
      { signal: 'I2C SDA (both codecs)', teensyPin: 18 },
      { signal: 'I2C SCL (both codecs)', teensyPin: 19 },
      { signal: 'Codec RESET (active low, both)', teensyPin: 22 },
      { signal: 'UART RX from the surface (MIDI)', teensyPin: 0, note: 'Serial1' },
      { signal: 'UART TX to the surface (MIDI)', teensyPin: 1, note: 'Serial1' },
    ],
    notes: [
      'The two codecs need different I2C addresses (strap the AD pin differently; check the CS42448 datasheet).',
      'Each codec has its own MCLK from its own SAI; keeping them phase-locked is part of what is unproven.',
      'Fallback if the second codec will not play: build the 3-channel board (teensy41-cs42448) twice, with two Teensys, and link them over the surface MIDI.',
    ],
    sources: CS42448_SOURCES,
  },
};

export type IoDirection = 'in' | 'out';

export interface IoConnector {
  part: string; // catalog PARTS id (category 'connector')
  label: string; // 'L', 'R', 'A L', ...
  dx: number; // mm from the plate centre, +x right (as seen from outside)
  dy: number; // mm from the plate centre, +y DOWN
}

/** Input stage of a module: what a nominal signal looks like and what the module does to it before the codec. */
export interface IoInput {
  id: 'A' | 'B';
  label: string;
  nominalDbV: number; // nominal level at the jack
  padDb: number; // fixed analogue pad (<= 0)
  preampDb: number; // mic preamp gain, else 0
}

export interface IoModule {
  id: string;
  name: string;
  direction: IoDirection;
  signal: 'stereo' | 'mono';
  /** Codec inputs (direction 'in') or outputs ('out') this module uses; mono mic = 1, everything else 2. */
  codecPorts: number;
  /** Output modules: which stereo bus feeds them (master, booth, phones). */
  bus?: 'master' | 'booth' | 'phones';
  connectors: IoConnector[];
  /** Panel the connectors live on: 'slot' = removable plate in a rear slot, 'top' = fixed jacks on the top panel. */
  mount: 'slot' | 'top';
  inputs?: IoInput[]; // 'in' modules; two entries = A/B selectable by SEL
  selectable?: boolean; // A/B switched by the SEL pin (relay on the module)
  phantom: boolean; // +48 V available on the XLR pins, switched on the module
  gainRangeDb?: [number, number]; // analogue gain range of the preamp, when there is one
  levelNote: string;
  frontEnd: BomLine[]; // parts on the module PCB (besides connectors)
  pcbUsd: number; // module PCB, approx. fab cost per board
  idOhm: number | null; // resistor from the ID pin to AGND; null = open (blank plate)
  power: { p12Ma: number; m12Ma: number; p5Ma: number; p48Ma: number }; // typical draw from the power board
  maturity: Maturity;
  maturityNote: string;
}

const fe = (name: string, partNumber: string, qty: number, priceUsd: number, notes?: string): BomLine => ({ name, partNumber, qty, priceUsd, maturity: 'experimental', ...(notes && { notes }) });
const LINE_RX = fe('Balanced line receiver (dual)', 'TI INA2137 (or 2 x THAT1246)', 1, 6, 'Candidate, unverified: single-ended output from a balanced or unbalanced TRS pair.');
const DIFF_DRV = fe('Differential driver to the codec (dual)', 'THAT1646 or TI DRV134 (candidate)', 1, 5, 'Candidate, unverified: turns the line signal into the balanced L+/L-/R+/R- pair at the codec full-scale level.');
const BUF = fe('Dual op-amp buffer', 'TI OPA1642 / NJM4580 (candidate)', 1, 2.5, 'Candidate, unverified.');
const MIC = fe('Mic preamplifier', 'THAT1510 / THAT1512 (pin-compatible with INA217 / INA163)', 1, 6, 'Phantom power follows the open design at github.com/ojg/thatmicpre (48 V, about 30 mA).');
const RELAY = fe('A/B select relay (DPDT)', 'Panasonic TQ2-5V', 1, 3, 'Candidate: audio-friendly (no switch distortion), about 40 mA at 5 V per module. An analog switch such as the ADG1236 would save the current; not checked for noise or distortion.');
const PASSIVES = (usd: number) => fe('Passives', 'resistors, film capacitors, DC-blocking caps, ID resistor, 2 x8 IDC header', 1, usd);

const CONNECTORS_XLR_IN = (n: number): IoConnector[] => Array.from({ length: n }, (_, i) => ({ part: 'conn-xlr-f', label: n === 1 ? 'Mic' : i === 0 ? 'L' : 'R', dx: 0, dy: n === 1 ? 0 : i === 0 ? -17.5 : 17.5 }));

export const IO_MODULES: Record<string, IoModule> = {
  'io-dual-trs': {
    id: 'io-dual-trs',
    name: 'Dual 6.3 mm TRS line input',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-trs-63-d', label: 'L', dx: 0, dy: -17.5 }, { part: 'conn-trs-63-d', label: 'R', dx: 0, dy: 17.5 }],
    inputs: [{ id: 'A', label: '6.3 mm pair, balanced or unbalanced, +4 dBu', nominalDbV: 1.8, padDb: -12, preampDb: 0 }],
    levelNote: 'Pro line level: +4 dBu nominal lands near -10 dBFS after a 12 dB pad.',
    frontEnd: [LINE_RX, DIFF_DRV, PASSIVES(1)], pcbUsd: 3, idOhm: 1000,
    power: { p12Ma: 12, m12Ma: 12, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Front-end ICs are candidates (INA2137 / THAT1246, THAT1646 / DRV134) nobody here has built. The connectors are real parts; see their own notes.',
  },
  'io-dual-mini': {
    id: 'io-dual-mini',
    name: 'Dual 3.5 mm line input',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-mini-mono', label: 'L', dx: 0, dy: -10 }, { part: 'conn-mini-mono', label: 'R', dx: 0, dy: 10 }],
    inputs: [{ id: 'A', label: '3.5 mm mono pair, -10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 }],
    levelNote: 'Consumer / modular line level: -10 dBV nominal lands near -10 dBFS with no pad.',
    frontEnd: [BUF, DIFF_DRV, PASSIVES(1)], pcbUsd: 3, idOhm: 2200,
    power: { p12Ma: 8, m12Ma: 8, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Candidate op-amp and driver; the 3.5 mm jack hole is assumed.',
  },
  'io-rca': {
    id: 'io-rca',
    name: 'RCA line input',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-rca', label: 'L', dx: 0, dy: -12 }, { part: 'conn-rca', label: 'R', dx: 0, dy: 12 }],
    inputs: [{ id: 'A', label: 'RCA pair, -10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 }],
    levelNote: 'Consumer line level: -10 dBV nominal lands near -10 dBFS with no pad.',
    frontEnd: [BUF, DIFF_DRV, PASSIVES(1)], pcbUsd: 3, idOhm: 3300,
    power: { p12Ma: 8, m12Ma: 8, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Candidate op-amp and driver; the RCA jack part and hole are not verified.',
  },
  'io-stereo-trs': {
    id: 'io-stereo-trs',
    name: 'Single 6.3 mm stereo (TRS) line input',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-trs-63-d', label: 'L/R', dx: 0, dy: 0 }],
    inputs: [{ id: 'A', label: '6.3 mm stereo, tip = L, ring = R, -10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 }],
    levelNote: 'Unbalanced stereo (tip = left, ring = right), consumer level, no pad.',
    frontEnd: [BUF, DIFF_DRV, PASSIVES(1)], pcbUsd: 3, idOhm: 4700,
    power: { p12Ma: 8, m12Ma: 8, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Candidate op-amp and driver.',
  },
  'io-stereo-mini': {
    id: 'io-stereo-mini',
    name: 'Single 3.5 mm stereo (TRS) line input',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-mini-stereo', label: 'L/R', dx: 0, dy: 0 }],
    inputs: [{ id: 'A', label: '3.5 mm stereo, -10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 }],
    levelNote: 'Phone / laptop line level: -10 dBV nominal, no pad.',
    frontEnd: [BUF, DIFF_DRV, PASSIVES(1)], pcbUsd: 3, idOhm: 6800,
    power: { p12Ma: 8, m12Ma: 8, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Candidate op-amp and driver.',
  },
  'io-xlr': {
    id: 'io-xlr',
    name: 'Single XLR mic / line input (mono, phantom)',
    direction: 'in', signal: 'mono', codecPorts: 1, mount: 'slot', phantom: true,
    connectors: CONNECTORS_XLR_IN(1),
    inputs: [{ id: 'A', label: 'XLR mic, -50 dBu', nominalDbV: -52.2, padDb: 0, preampDb: 40 }],
    gainRangeDb: [20, 60],
    levelNote: 'Mic: default analogue gain 40 dB. The range is 20-60 dB with a gain resistor change; not switchable from the surface. The engine feeds the mono signal to both sides (dual-mono).',
    frontEnd: [MIC, DIFF_DRV, fe('Phantom power parts', '6.8 k 0.1 % resistor pair, 48 V electrolytic/film caps, phantom switch', 1, 3, 'Switched on the module (PH_EN pin or a slide switch).'), PASSIVES(1.5)],
    pcbUsd: 3, idOhm: 10000,
    power: { p12Ma: 10, m12Ma: 10, p5Ma: 0, p48Ma: 10 },
    maturity: 'experimental', maturityNote: 'THAT1510/1512 is a well-known mic preamp, and an open phantom reference exists (github.com/ojg/thatmicpre), but this module has not been built or measured.',
  },
  'io-dual-xlr': {
    id: 'io-dual-xlr',
    name: 'Dual XLR mic / line input (stereo pair, phantom)',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: true,
    connectors: CONNECTORS_XLR_IN(2),
    inputs: [{ id: 'A', label: 'XLR mic pair, -50 dBu', nominalDbV: -52.2, padDb: 0, preampDb: 40 }],
    gainRangeDb: [20, 60],
    levelNote: 'Two mic inputs as left and right; analogue gain 40 dB by default, range 20-60 dB with resistor changes.',
    frontEnd: [{ ...MIC, qty: 2 }, { ...DIFF_DRV }, fe('Phantom power parts', '6.8 k 0.1 % resistor pairs, 48 V caps, phantom switch', 2, 3), PASSIVES(2)],
    pcbUsd: 4, idOhm: 15000,
    power: { p12Ma: 20, m12Ma: 20, p5Ma: 0, p48Ma: 20 },
    maturity: 'experimental', maturityNote: 'Same as io-xlr, twice.',
  },
  'io-trs-rca-combo': {
    id: 'io-trs-rca-combo',
    name: 'A/B input: 6.3 mm pair (A) or RCA pair (B)',
    direction: 'in', signal: 'stereo', codecPorts: 2, mount: 'slot', phantom: false, selectable: true,
    connectors: [
      { part: 'conn-trs-63-panel', label: 'A L', dx: -8, dy: -17 }, { part: 'conn-trs-63-panel', label: 'A R', dx: 8, dy: -17 },
      { part: 'conn-rca', label: 'B L', dx: -8, dy: 17 }, { part: 'conn-rca', label: 'B R', dx: 8, dy: 17 },
    ],
    inputs: [
      { id: 'A', label: '6.3 mm pair, +4 dBu', nominalDbV: 1.8, padDb: -12, preampDb: 0 },
      { id: 'B', label: 'RCA pair, -10 dBV', nominalDbV: -10, padDb: 0, preampDb: 0 },
    ],
    levelNote: 'SEL = 0 listens to A, SEL = 1 to B. Each side has its own pad so both land near -10 dBFS; the relay switches after the pads.',
    frontEnd: [LINE_RX, BUF, RELAY, DIFF_DRV, PASSIVES(2)], pcbUsd: 4, idOhm: 22000,
    power: { p12Ma: 16, m12Ma: 16, p5Ma: 40, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Relay is a candidate (a Panasonic TQ2 DPDT signal relay); 5 V coil current is not in the power budget until you check the datasheet. The Engine drives the surface A/B button into the SEL pin.',
  },
  'out-trs-rca-combo': {
    id: 'out-trs-rca-combo',
    name: 'Master out: 6.3 mm pair or RCA pair (selectable)',
    direction: 'out', signal: 'stereo', codecPorts: 2, bus: 'master', mount: 'slot', phantom: false, selectable: true,
    connectors: [
      { part: 'conn-trs-63-panel', label: 'TRS L', dx: -8, dy: -17 }, { part: 'conn-trs-63-panel', label: 'TRS R', dx: 8, dy: -17 },
      { part: 'conn-rca', label: 'RCA L', dx: -8, dy: 17 }, { part: 'conn-rca', label: 'RCA R', dx: 8, dy: 17 },
    ],
    levelNote: 'SEL picks which jack pair is live (TRS pair is balanced +4 dBu, RCA pair unbalanced -10 dBV). Leaving both live in parallel works too: drop the relay.',
    frontEnd: [fe('Output buffer / line driver (dual)', 'DRV134 or THAT1646 for the TRS pair, op-amp for RCA (candidates)', 1, 6), RELAY, PASSIVES(2)], pcbUsd: 4, idOhm: 33000,
    power: { p12Ma: 14, m12Ma: 14, p5Ma: 40, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Driver and relay are candidates; the codec DAC full-scale output level is NOT verified, so the output gain staging is open.',
  },
  'out-xlr-pair': {
    id: 'out-xlr-pair',
    name: 'Master out: L/R XLR (balanced)',
    direction: 'out', signal: 'stereo', codecPorts: 2, bus: 'master', mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-xlr-m', label: 'L', dx: 0, dy: -17.5 }, { part: 'conn-xlr-m', label: 'R', dx: 0, dy: 17.5 }],
    levelNote: 'Balanced +4 dBu line out on two male XLRs (pin 2 hot, pin 3 cold, pin 1 ground).',
    frontEnd: [fe('Balanced line driver (dual)', 'TI DRV134 / THAT1646 (candidates)', 1, 6), PASSIVES(1.5)], pcbUsd: 3, idOhm: 47000,
    power: { p12Ma: 12, m12Ma: 12, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Driver ICs are candidates; DAC full-scale level is not verified.',
  },
  'out-booth': {
    id: 'out-booth',
    name: 'Booth out: RCA pair',
    direction: 'out', signal: 'stereo', codecPorts: 2, bus: 'booth', mount: 'slot', phantom: false,
    connectors: [{ part: 'conn-rca', label: 'L', dx: 0, dy: -12 }, { part: 'conn-rca', label: 'R', dx: 0, dy: 12 }],
    levelNote: 'Unbalanced -10 dBV to the booth monitors, level = the BOOTH knob.',
    frontEnd: [fe('Output buffer (dual)', 'TI OPA1642 / NJM4580 (candidates)', 1, 2.5), PASSIVES(1)], pcbUsd: 3, idOhm: 68000,
    power: { p12Ma: 8, m12Ma: 8, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Candidate op-amp; RCA jack not verified.',
  },
  'out-phones': {
    id: 'out-phones',
    name: 'Phones out: 6.3 mm + 3.5 mm on the top panel',
    direction: 'out', signal: 'stereo', codecPorts: 2, bus: 'phones', mount: 'top', phantom: false,
    connectors: [{ part: 'phones-jack-63', label: '6.3 mm', dx: 0, dy: 0 }, { part: 'phones-jack-35', label: '3.5 mm', dx: 0, dy: 0 }],
    levelNote: 'Headphone amplifier on the main power board; both jacks are wired in parallel and live on the top panel like DJ mixers.',
    frontEnd: [fe('Headphone amplifier', 'TI TPA6120A2 or NJM4556 (candidates)', 1, 5, 'Candidates, unverified. Heat and +/-12 V current are not budgeted.'), PASSIVES(2)], pcbUsd: 3, idOhm: null,
    power: { p12Ma: 30, m12Ma: 30, p5Ma: 0, p48Ma: 0 },
    maturity: 'experimental', maturityNote: 'Amplifier is a candidate; no thermal or current budget.',
  },
};

/** Master output modules the mixer offers as a set, in rear-slot order (phones are top-panel jacks, not a slot). */
export const DEFAULT_MASTER_OUTPUTS = ['out-trs-rca-combo', 'out-xlr-pair', 'out-booth', 'out-phones'] as const;

export interface PowerRail {
  rail: string;
  maxMa: number;
  source: string;
}
/** Power board: USB-C PD in, three rails out. Every part here is a candidate. */
export const POWER_BOARD = {
  name: 'kont.rolla power board',
  maturity: 'experimental' as Maturity,
  maturityNote: 'Candidate architecture, nothing built. HUSB238 is the PD sink to use; CH224K breakouts have been reported to reset-loop.',
  input: 'USB-C PD sink negotiating 15 V or 20 V',
  rails: [
    { rail: '+5 V', maxMa: 1500, source: 'step-down from the PD voltage (surface LEDs, Teensy, relay coils)' },
    { rail: '+12 V / -12 V', maxMa: 300, source: 'step-down to 12 V plus an inverting converter for -12 V, post-filtered with LC and LDOs (analog front ends)' },
    { rail: '+48 V', maxMa: 60, source: 'low-noise boost from 12 V for phantom power (about 10 mA per mic; 4 mics = 40 mA)' },
  ] as PowerRail[],
  bom: [
    { name: 'USB-C PD sink', partNumber: 'Adafruit 5991 (HUSB238 breakout)', qty: 1, priceUsd: 6, maturity: 'experimental', notes: 'Verify it negotiates 15/20 V at your charger; the sink is configured over I2C or pins. Avoid CH224K boards: reset loops reported.' },
    { name: '+5 V buck', partNumber: 'Pololu D24V22F5 (candidate)', qty: 1, priceUsd: 15, maturity: 'experimental' },
    { name: '+12 V buck', partNumber: 'Pololu D24V10F12 (candidate)', qty: 1, priceUsd: 10, maturity: 'experimental' },
    { name: '-12 V inverter', partNumber: 'to be chosen (inverting converter + LDO)', qty: 1, priceUsd: 6, maturity: 'experimental' },
    { name: '+48 V boost', partNumber: 'to be chosen (low-noise phantom boost)', qty: 1, priceUsd: 6, maturity: 'experimental' },
    { name: 'USB-C receptacle + bulk caps', partNumber: 'panel-aligned USB-C receptacle, 2 x 470 uF', qty: 1, priceUsd: 2, maturity: 'experimental' },
  ] as BomLine[],
  sources: ['https://www.adafruit.com/product/5991', 'https://github.com/ojg/thatmicpre'],
};
