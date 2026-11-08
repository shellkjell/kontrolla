// Config blob v3 parsing (docs/CONTRACTS.md §1). Blob lives at XIP 0x101F0000.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define BLOB_ADDR 0x101F0000u
#define BLOB_MAX 4096
#define BLOB_MAGIC 0x314C524Bu
#define BLOB_VERSION 3

typedef struct { uint8_t pin, count, brightness, pad[5]; } LedRec;                  // pin 0xFF = none
typedef struct { uint8_t tx, rx, pad[6]; } PortRec;                                 // UART MIDI port GPIOs, 0xFF = none
typedef struct { uint8_t sig, sel[4], digital, en, pad; } MuxRec;                    // sig = GPIO, en = active-low EN GPIO or 0xFF
typedef struct {
  uint8_t kind, pinA, pinB, muxIndex, muxChannel, midiType, channel, number,
      min, max, flags, debounceMs, deadband, smoothing, led, r, g, b, pad[2];     // led 0xFF = none
} CtrlRec;
typedef struct { uint8_t channel, cc, ledStart, ledCount, pad[4]; } MeterRec;

typedef struct {
  bool valid;
  char product[33];
  uint8_t controlCount, muxCount, meterCount;
  const LedRec *led;
  const PortRec *port;
  const MuxRec *mux;
  const CtrlRec *ctrl;
  const MeterRec *meter;
} Config;

uint32_t crc32_ieee(const uint8_t *p, uint32_t n);
void config_load(Config *c, const uint8_t *blob);
