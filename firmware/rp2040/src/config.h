// Config blob parsing (docs/CONTRACTS.md §1). Blob lives at XIP 0x101F0000.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define BLOB_ADDR 0x101F0000u
#define BLOB_MAX 4096
#define BLOB_MAGIC 0x314C524Bu

typedef struct { uint8_t sigAdc, sel[4], pad[3]; } MuxRec;
typedef struct {
  uint8_t kind, pinA, pinB, muxIndex, muxChannel, midiType, channel, number,
      min, max, flags, debounceMs, deadband, smoothing, pad[2];
} CtrlRec;

typedef struct {
  bool valid;
  char product[33];
  uint8_t controlCount, muxCount;
  const MuxRec *mux;
  const CtrlRec *ctrl;
} Config;

uint32_t crc32_ieee(const uint8_t *p, uint32_t n);
void config_load(Config *c, const uint8_t *blob);
