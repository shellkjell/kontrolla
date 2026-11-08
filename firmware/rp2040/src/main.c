// Generic kont.rolla firmware: semantics per docs/CONTRACTS.md §2.
#include "config.h"
#include "hardware/adc.h"
#include "hardware/dma.h"
#include "hardware/gpio.h"
#include "hardware/pio.h"
#include "ws2812.pio.h"
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
  bool stable, on, ledOn;
  uint8_t counter;
  // encoder
  uint8_t prev;
  int8_t q;
  int16_t value;
} State;
static State st[256];
static uint8_t lit[256];  // per meter
static bool dirty;
static uint32_t scanCount;
static uint32_t ledbuf[255];
static int led_dma = -1;

static void midi_send(uint8_t status, uint8_t d1, uint8_t d2) {
  uint8_t pkt[4] = {status >> 4, status, d1 & 0x7F, d2 & 0x7F};  // cable 0, CIN = status nibble
  while (tud_mounted() && !tud_midi_n_packet_write(0, pkt)) tud_task();
}

static void send_cc(const CtrlRec *c, int v) { midi_send(0xB0 | c->channel, c->number, v); }

static void send_onoff(const CtrlRec *c, bool on) {
  if (c->midiType == 2) midi_send((on ? 0x90 : 0x80) | c->channel, c->number, on ? c->max : 0);
  else send_cc(c, on ? c->max : c->min);
}

static void led_push(void);

static int32_t floor_div(int32_t a, int32_t b) {  // b > 0
  int32_t q = a / b;
  return (a % b < 0) ? q - 1 : q;
}

static void mux_select(const MuxRec *m, uint8_t channel) {
  for (int i = 0; i < 4; i++) gpio_put(m->sel[i], (channel >> i) & 1);
  busy_wait_us(10);
}

static void scan_analog(const CtrlRec *c, State *s) {
  uint8_t ch = c->pinA;
  if (c->muxIndex != 0xFF) {
    const MuxRec *m = &cfg.mux[c->muxIndex];
    mux_select(m, c->muxChannel);
    ch = m->sig - 26;
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
  bool raw;  // pressed = low
  if (c->muxIndex != 0xFF) {
    const MuxRec *m = &cfg.mux[c->muxIndex];
    mux_select(m, c->muxChannel);
    raw = !gpio_get(m->sig);
  } else {
    raw = !gpio_get(c->pinA);
  }
  if (raw == s->stable) { s->counter = 0; return; }
  if (++s->counter < c->debounceMs && c->debounceMs) return;
  s->stable = raw;
  s->counter = 0;
  bool on = raw;
  if (c->flags & 1) {
    if (!raw) return;
    s->on = !s->on;
    on = s->on;
  }
  s->ledOn = on;
  dirty = true;
  send_onoff(c, on);
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
  if (cfg.led->count && scanCount % 10 == 0 && (dirty || scanCount == 0)) led_push();
  scanCount++;
}


// ---- WS2812 (CONTRACTS §2.2): frame built from button/meter state, sent by PIO fed from DMA ----
static void put_led(uint32_t *g, uint8_t i, uint8_t r, uint8_t gr, uint8_t b) {
  if (i < cfg.led->count) g[i] = ((uint32_t)gr << 16) | ((uint32_t)r << 8) | b;
}

static void led_push(void) {
  if (led_dma < 0 || dma_channel_is_busy(led_dma)) return;  // stays dirty, retried 10 scans later
  uint32_t px[255] = {0};
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    if (c->kind != 2 || c->led == 0xFF) continue;
    int sh = st[i].ledOn ? 0 : 4;
    put_led(px, c->led, c->r >> sh, c->g >> sh, c->b >> sh);
  }
  for (int t = 0; t < cfg.meterCount; t++) {
    const MeterRec *m = &cfg.meter[t];
    for (int i = 0; i < m->ledCount; i++) {
      if (i >= lit[t]) put_led(px, m->ledStart + i, 0, 0, 0);
      else if (i * 10 < m->ledCount * 6) put_led(px, m->ledStart + i, 0, 255, 0);
      else if (i * 20 < m->ledCount * 17) put_led(px, m->ledStart + i, 255, 160, 0);
      else put_led(px, m->ledStart + i, 255, 0, 0);
    }
  }
  uint32_t b = cfg.led->brightness;
  for (int i = 0; i < cfg.led->count; i++) {
    uint32_t g = (((px[i] >> 16) & 255) * b) >> 8, r = (((px[i] >> 8) & 255) * b) >> 8, bl = ((px[i] & 255) * b) >> 8;
    ledbuf[i] = ((g << 16) | (r << 8) | bl) << 8;  // GRB in the top 24 bits (autopull threshold 24, shift left)
  }
  dirty = false;
  dma_channel_set_read_addr(led_dma, ledbuf, false);
  dma_channel_set_trans_count(led_dma, cfg.led->count, true);
}

static void led_init(void) {
  uint offset = pio_add_program(pio0, &ws2812_program);
  ws2812_program_init(pio0, 0, offset, cfg.led->pin);
  led_dma = dma_claim_unused_channel(true);
  dma_channel_config dc = dma_channel_get_default_config(led_dma);
  channel_config_set_transfer_data_size(&dc, DMA_SIZE_32);
  channel_config_set_read_increment(&dc, true);
  channel_config_set_write_increment(&dc, false);
  channel_config_set_dreq(&dc, pio_get_dreq(pio0, 0, true));
  dma_channel_configure(led_dma, &dc, &pio0->txf[0], ledbuf, 0, false);
}

// ---- host -> device MIDI (CONTRACTS §2.1): button feedback and meter levels, nothing echoed ----
static void midi_in(uint8_t status, uint8_t d1, uint8_t d2) {
  uint8_t type = status & 0xF0, ch = status & 0x0F;
  d1 &= 0x7F;
  d2 &= 0x7F;
  if (type != 0x80 && type != 0x90 && type != 0xB0) return;
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    if (c->kind != 2 || c->channel != ch || c->number != d1) continue;
    bool on;
    if (c->midiType == 2 && (type == 0x90 || type == 0x80)) on = type == 0x90 && d2 > 0;
    else if (c->midiType == 1 && type == 0xB0) on = d2 >= 64;
    else continue;
    st[i].ledOn = on;
    if (c->flags & 1) st[i].on = on;
    dirty = true;
  }
  if (type == 0xB0)
    for (int t = 0; t < cfg.meterCount; t++) {
      const MeterRec *m = &cfg.meter[t];
      if (m->channel == ch && m->cc == d1) { lit[t] = (d2 * m->ledCount + 126) / 127; dirty = true; }
    }
}

static void hw_init(void) {
  adc_init();
  bool adc_used[3] = {0};
  for (int i = 0; i < cfg.muxCount; i++) {
    const MuxRec *m = &cfg.mux[i];
    for (int j = 0; j < 4; j++) { gpio_init(m->sel[j]); gpio_set_dir(m->sel[j], GPIO_OUT); }  // shared buses: idempotent
    if (m->digital) { gpio_init(m->sig); gpio_set_dir(m->sig, GPIO_IN); gpio_pull_up(m->sig); }
    else if (m->sig >= 26 && m->sig <= 28) adc_used[m->sig - 26] = true;
  }
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    State *s = &st[i];
    s->first = true;
    s->prev = 3;
    s->value = c->min;
    if (c->kind == 1 && c->muxIndex == 0xFF && c->pinA < 3) adc_used[c->pinA] = true;
    if ((c->kind == 2 && c->muxIndex == 0xFF) || c->kind == 3) {
      gpio_init(c->pinA); gpio_set_dir(c->pinA, GPIO_IN); gpio_pull_up(c->pinA);
    }
    if (c->kind == 3) { gpio_init(c->pinB); gpio_set_dir(c->pinB, GPIO_IN); gpio_pull_up(c->pinB); }
  }
  for (int i = 0; i < 3; i++) if (adc_used[i]) adc_gpio_init(26 + i);
  if (cfg.led->count) led_init();
}

int main(void) {
  config_load(&cfg, (const uint8_t *)BLOB_ADDR);
  g_product = cfg.product;
  gpio_init(LED_PIN);
  gpio_set_dir(LED_PIN, GPIO_OUT);
  if (cfg.valid) hw_init();
  tusb_init();

  // Scanning starts once USB is configured (CONTRACTS §2): the first scan latches baselines.
  // Between scans sleep until the next 1 ms boundary; USB IRQs wake WFE so tud_task still runs promptly.
  bool started = false;
  uint64_t next = time_us_64();
  while (true) {
    tud_task();
    uint8_t pkt[4];
    while (tud_midi_n_packet_read(0, pkt)) if (cfg.valid) midi_in(pkt[1], pkt[2], pkt[3]);
    if (cfg.valid && !started) {
      if (!tud_mounted()) { best_effort_wfe_or_timeout(make_timeout_time_ms(1)); continue; }
      started = true;
      next = time_us_64();
    }
    uint64_t now = time_us_64();
    if (now < next) { best_effort_wfe_or_timeout(from_us_since_boot(next)); continue; }
    next += 1000;
    if (cfg.valid) scan();
    else gpio_put(LED_PIN, (now / 250000) & 1);  // blink ~2 Hz
  }
}
