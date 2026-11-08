#include "config.h"
#include <string.h>

uint32_t crc32_ieee(const uint8_t *p, uint32_t n) {
  uint32_t c = 0xFFFFFFFFu;
  while (n--) {
    c ^= *p++;
    for (int i = 0; i < 8; i++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1));
  }
  return ~c;
}

static uint32_t rd32(const uint8_t *p) { return p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24; }
static uint32_t rd16(const uint8_t *p) { return p[0] | p[1] << 8; }

void config_load(Config *c, const uint8_t *b) {
  memset(c, 0, sizeof *c);
  strcpy(c->product, "kont.rolla (no config)");
  if (rd32(b) != BLOB_MAGIC || rd16(b + 4) != BLOB_VERSION) return;
  uint32_t len = rd16(b + 6), nc = b[8], nm = b[9], nt = b[10];
  if (nm > 16 || len > BLOB_MAX || len != 44 + 8 + 8 + 8 * nm + 20 * nc + 8 * nt + 4) return;
  if (crc32_ieee(b, len - 4) != rd32(b + len - 4)) return;
  c->valid = true;
  c->controlCount = nc;
  c->muxCount = nm;
  c->meterCount = nt;
  c->led = (const LedRec *)(b + 44);
  c->port = (const PortRec *)(b + 52);
  c->mux = (const MuxRec *)(b + 60);
  c->ctrl = (const CtrlRec *)(b + 60 + 8 * nm);
  c->meter = (const MeterRec *)(b + 60 + 8 * nm + 20 * nc);
  memcpy(c->product, b + 12, 32);
  c->product[32] = 0;
  if (!c->product[0]) strcpy(c->product, "kont.rolla");
}
