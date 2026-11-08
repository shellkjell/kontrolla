// Generic kont.rolla firmware: semantics per docs/CONTRACTS.md §2.
#include "config.h"
#include "hardware/adc.h"
#include "hardware/gpio.h"
#include "pico/stdlib.h"
#include "tusb.h"

#define LED_PIN 25
extern const char *g_product;

static Config cfg;

typedef struct {
  // analog
  bool first;
  int32_t acc, lastS, lastV;
  // button
  bool stable, on;
  uint8_t counter;
  // encoder
  uint8_t prev;
  int8_t q;
  int16_t value;
} State;
static State st[256];

static void midi_send(uint8_t status, uint8_t d1, uint8_t d2) {
  uint8_t pkt[4] = {status >> 4, status, d1 & 0x7F, d2 & 0x7F};  // cable 0, CIN = status nibble
  while (tud_mounted() && !tud_midi_n_packet_write(0, pkt)) tud_task();
}

static void send_cc(const CtrlRec *c, int v) { midi_send(0xB0 | c->channel, c->number, v); }

static void send_onoff(const CtrlRec *c, bool on) {
  if (c->midiType == 2) midi_send((on ? 0x90 : 0x80) | c->channel, c->number, on ? c->max : 0);
  else send_cc(c, on ? c->max : c->min);
}

static int32_t floor_div(int32_t a, int32_t b) {  // b > 0
  int32_t q = a / b;
  return (a % b < 0) ? q - 1 : q;
}

static void scan_analog(const CtrlRec *c, State *s) {
  uint8_t ch = c->pinA;
  if (c->muxIndex != 0xFF) {
    const MuxRec *m = &cfg.mux[c->muxIndex];
    for (int i = 0; i < 4; i++) gpio_put(m->sel[i], (c->muxChannel >> i) & 1);
    busy_wait_us(10);
    ch = m->sigAdc;
  }
  adc_select_input(ch);
  int32_t raw = adc_read();
  if (s->first) {
    s->acc = raw << 4;
  } else {
    int32_t k = 256 - c->smoothing;
    s->acc += (((raw << 4) - s->acc) * k) >> 8;
  }
  int32_t sm = s->acc >> 4;
  int32_t v = c->min + floor_div(sm * ((int32_t)c->max - c->min) + 2047, 4095);
  if (s->first) {
    s->first = false;
    s->lastS = sm;
    s->lastV = v;
    return;
  }
  int32_t d = sm - s->lastS;
  if (v != s->lastV && (d < 0 ? -d : d) >= c->deadband) {
    send_cc(c, v);
    s->lastV = v;
    s->lastS = sm;
  }
}

static void scan_button(const CtrlRec *c, State *s) {
  bool raw = !gpio_get(c->pinA);  // pressed = low
  if (raw == s->stable) { s->counter = 0; return; }
  if (++s->counter < c->debounceMs && c->debounceMs) return;
  s->stable = raw;
  s->counter = 0;
  if (c->flags & 1) {
    if (raw) { s->on = !s->on; send_onoff(c, s->on); }
  } else {
    send_onoff(c, raw);
  }
}

static void scan_encoder(const CtrlRec *c, State *s) {
  static const int8_t TABLE[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  uint8_t cur = (gpio_get(c->pinA) << 1) | gpio_get(c->pinB);
  s->q += TABLE[(s->prev << 2) | cur];
  s->prev = cur;
  int dir = 0;
  if (s->q >= 4) dir = 1;
  else if (s->q <= -4) dir = -1;
  if (!dir) return;
  s->q = 0;
  if (c->flags & 2) {
    send_cc(c, dir > 0 ? 65 : 63);
  } else {
    int v = s->value + dir;
    if (v < c->min) v = c->min;
    if (v > c->max) v = c->max;
    if (v != s->value) { s->value = v; send_cc(c, v); }
  }
}

void scan(void) {
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    if (c->kind == 1) scan_analog(c, &st[i]);
    else if (c->kind == 2) scan_button(c, &st[i]);
    else if (c->kind == 3) scan_encoder(c, &st[i]);
  }
}

static void hw_init(void) {
  adc_init();
  bool adc_used[3] = {0};
  for (int i = 0; i < cfg.muxCount; i++) {
    for (int j = 0; j < 4; j++) { gpio_init(cfg.mux[i].sel[j]); gpio_set_dir(cfg.mux[i].sel[j], GPIO_OUT); }
    if (cfg.mux[i].sigAdc < 3) adc_used[cfg.mux[i].sigAdc] = true;
  }
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    State *s = &st[i];
    s->first = true;
    s->prev = 3;
    s->value = c->min;
    if (c->kind == 1 && c->muxIndex == 0xFF && c->pinA < 3) adc_used[c->pinA] = true;
    if (c->kind == 2 || c->kind == 3) {
      gpio_init(c->pinA); gpio_set_dir(c->pinA, GPIO_IN); gpio_pull_up(c->pinA);
    }
    if (c->kind == 3) { gpio_init(c->pinB); gpio_set_dir(c->pinB, GPIO_IN); gpio_pull_up(c->pinB); }
  }
  for (int i = 0; i < 3; i++) if (adc_used[i]) adc_gpio_init(26 + i);
}

int main(void) {
  config_load(&cfg, (const uint8_t *)BLOB_ADDR);
  g_product = cfg.product;
  gpio_init(LED_PIN);
  gpio_set_dir(LED_PIN, GPIO_OUT);
  if (cfg.valid) hw_init();
  tusb_init();

  uint64_t next = time_us_64() + 1000;
  while (true) {
    tud_task();
    uint64_t now = time_us_64();
    if (now < next) continue;
    next += 1000;
    if (cfg.valid) scan();
    else gpio_put(LED_PIN, (now / 250000) & 1);  // blink ~2 Hz
  }
}
