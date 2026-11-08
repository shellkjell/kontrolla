// Generic kont.rolla firmware: semantics per docs/CONTRACTS.md §2.
#include "config.h"
#include "hardware/adc.h"
#include "hardware/dma.h"
#include "hardware/gpio.h"
#include "hardware/irq.h"
#include "hardware/pio.h"
#include "hardware/timer.h"
#include "hardware/uart.h"
#include "ws2812.pio.h"
#include "pico/stdlib.h"
#include "tusb.h"

#define LED_PIN 25
extern const char *g_product;

static Config cfg;

typedef struct {
  // analog
  bool first;
  int16_t pre;  // mux controls: raw sampled by the bus-major pre-pass (analog 0..4095, button 1 = pressed)
  int32_t acc, lastS, lastV, curS, curV;  // cur*: this scan's smoothed value and mapped CC value (for snapshots)
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
static bool snap_req;  // snapshot request pending (CONTRACTS §2.5): served at the end of the next scan
static uint32_t scanCount;
static uint32_t ledbuf[255];
static int led_dma = -1;

// ---- UART MIDI port (CONTRACTS §2.3): TX mirrors every USB message in order via a ring drained from the main loop ----
#define TXRING 4096
static uart_inst_t *port_uart;
static uint8_t txring[TXRING];
static uint16_t txh, txt;

static void port_tx(uint8_t b) {
  uint16_t n = (txh + 1) & (TXRING - 1);
  if (port_uart && cfg.port->tx != 0xFF && n != txt) { txring[txh] = b; txh = n; }  // a full ring drops (4096 B = 1.3 s of wire time)
}

static void port_drain(void) {
  while (txt != txh && uart_is_writable(port_uart)) { uart_putc_raw(port_uart, txring[txt]); txt = (txt + 1) & (TXRING - 1); }
}

static void midi_send(uint8_t status, uint8_t d1, uint8_t d2) {
  port_tx(status);
  port_tx(d1 & 0x7F);
  port_tx(d2 & 0x7F);
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

// 10 us mux settle (CONTRACTS §2). Sleeping on TIMER alarm 2 instead of spinning costs ~30 instructions rather than ~800,
// which is what lets the emulator keep real time with 60 mux reads per scan; on silicon the wake-up adds well under 1 us.
// Race-free: with interrupts masked a pending alarm still wakes WFI, and we poll the raw alarm status ourselves.
static void settle_nop(void) {}
static void settle_init(void) {
  irq_set_exclusive_handler(TIMER_IRQ_2, settle_nop);
  irq_set_enabled(TIMER_IRQ_2, true);
  hw_set_bits(&timer_hw->inte, 1u << 2);
}
static inline void sleep_us_alarm(uint32_t us) {  // us >= 2 (the 1 us timer tick must not already have passed)
  uint32_t ps = save_and_disable_interrupts();
  timer_hw->alarm[2] = timer_hw->timerawl + us;
  while (!(timer_hw->ints & (1u << 2))) __wfi();
  timer_hw->intr = 1u << 2;
  irq_clear(TIMER_IRQ_2);  // drop the latched NVIC pending bit so it is not taken on restore
  restore_interrupts(ps);
}
static inline void settle_10us(void) { sleep_us_alarm(11); }  // 1 us timer tick: +11 guarantees >= 10 us

// Per-mux GPIO masks, built once: one SIO write sets S0..S3 and (on a shared SIG pin) every EN together.
#define MUX_MAX 16
static uint32_t mux_mask[MUX_MAX], mux_base[MUX_MAX], mux_selmask[MUX_MAX], mux_selval[MUX_MAX][16];

static void mux_tables(void) {
  for (int i = 0; i < cfg.muxCount; i++) {
    const MuxRec *m = &cfg.mux[i];
    uint32_t selmask = 0, others = 0, own = 0;
    for (int j = 0; j < 4; j++) selmask |= 1u << m->sel[j];
    for (int ch = 0; ch < 16; ch++) {
      uint32_t v = 0;
      for (int j = 0; j < 4; j++) if ((ch >> j) & 1) v |= 1u << m->sel[j];
      mux_selval[i][ch] = v;
    }
    if (m->en != 0xFF) {  // shared SIG pin: this mux's EN (active low) low, every other EN on that pin high
      own = 1u << m->en;
      for (int k = 0; k < cfg.muxCount; k++) {
        const MuxRec *o = &cfg.mux[k];
        if (k != i && o->sig == m->sig && o->en != 0xFF) others |= 1u << o->en;
      }
    }
    mux_selmask[i] = selmask;
    mux_mask[i] = selmask | own | others;
    mux_base[i] = others;
  }
}

// ---- bus-major mux pre-pass (CONTRACTS §2.4) ----
// Every control on a mux is sampled once per scan, ordered by (select bus, channel, mux, control): S0..S3 are set once per
// (bus, channel) and settle 10 us, then each mux with a control there is read. Muxes sharing a SIG pin switch EN
// (settle ~1 us) when the previous read on that pin was another mux. Processing then runs in record order, as before.
static uint8_t rd_ctrl[256], rd_mux[256], rd_ch[256], rd_bus[256];
static bool rd_new[256];
static int rd_n;
static int8_t en_owner[30];  // SIG GPIO -> mux whose EN is currently low (-1 = none)

static void reads_init(void) {
  uint8_t bus[MUX_MAX];
  for (int i = 0; i < cfg.muxCount; i++) {  // bus id = first mux with the same four select pins
    bus[i] = i;
    for (int k = 0; k < i; k++)
      if (!memcmp(cfg.mux[k].sel, cfg.mux[i].sel, 4)) { bus[i] = bus[k]; break; }
  }
  for (int i = 0; i < 30; i++) en_owner[i] = -1;
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    if (c->kind == 3 || c->muxIndex == 0xFF) continue;
    int j = rd_n++;  // insertion sort by (bus, channel, mux, control)
    while (j > 0) {
      int pm = rd_mux[j - 1], pc = rd_ch[j - 1];
      bool after = bus[pm] < bus[c->muxIndex] || (bus[pm] == bus[c->muxIndex] && (pc < c->muxChannel || (pc == c->muxChannel && pm <= c->muxIndex)));
      if (after) break;
      rd_ctrl[j] = rd_ctrl[j - 1]; rd_mux[j] = rd_mux[j - 1]; rd_ch[j] = rd_ch[j - 1]; rd_bus[j] = rd_bus[j - 1];
      j--;
    }
    rd_ctrl[j] = i; rd_mux[j] = c->muxIndex; rd_ch[j] = c->muxChannel; rd_bus[j] = bus[c->muxIndex];
  }
  for (int k = 0; k < rd_n; k++) rd_new[k] = k == 0 || rd_bus[k] != rd_bus[k - 1] || rd_ch[k] != rd_ch[k - 1];
}

static void mux_prepass(void) {
  for (int k = 0; k < rd_n; k++) {
    int i = rd_mux[k];
    const MuxRec *m = &cfg.mux[i];
    if (rd_new[k]) {  // new (bus, channel): S0..S3 (+ this mux's EN state) in one write, then the 10 us settle
      gpio_put_masked(mux_mask[i], mux_base[i] | mux_selval[i][rd_ch[k] & 15]);
      if (m->en != 0xFF) en_owner[m->sig] = i;
      settle_10us();
    } else if (m->en != 0xFF && en_owner[m->sig] != i) {  // same select, another mux on a shared SIG pin: EN only
      gpio_put_masked(mux_mask[i] & ~mux_selmask[i], mux_base[i]);
      en_owner[m->sig] = i;
      sleep_us_alarm(2);  // EN-to-output ~0.1 us on a 74HC4067; the 1 us tick makes this 1-2 us
    }
    State *s = &st[rd_ctrl[k]];
    if (m->digital) {
      s->pre = !gpio_get(m->sig);
    } else {
      hw_write_masked(&adc_hw->cs, ((uint32_t)(m->sig - 26) << ADC_CS_AINSEL_LSB) | ADC_CS_START_ONCE_BITS, ADC_CS_AINSEL_BITS | ADC_CS_START_ONCE_BITS);
      sleep_us_alarm(3);  // conversion takes 2 us; the 1 us tick makes this 2-3 us, so READY is already set
      while (!(adc_hw->cs & ADC_CS_READY_BITS)) tight_loop_contents();
      s->pre = adc_hw->result & 0xfff;
    }
  }
}

static void scan_analog(const CtrlRec *c, State *s) {
  int32_t raw;
  if (c->muxIndex != 0xFF) {
    raw = s->pre;
  } else {
    hw_write_masked(&adc_hw->cs, ((uint32_t)c->pinA << ADC_CS_AINSEL_LSB) | ADC_CS_START_ONCE_BITS, ADC_CS_AINSEL_BITS | ADC_CS_START_ONCE_BITS);
    sleep_us_alarm(3);
    while (!(adc_hw->cs & ADC_CS_READY_BITS)) tight_loop_contents();
    raw = adc_hw->result & 0xfff;
  }
  if (s->first) {
    s->acc = raw << 4;
  } else {
    int32_t k = 256 - c->smoothing;
    s->acc += (((raw << 4) - s->acc) * k) >> 8;
  }
  int32_t sm = s->acc >> 4;
  int32_t v = c->min + floor_div(sm * ((int32_t)c->max - c->min) + 2047, 4095);
  s->curS = sm;
  s->curV = v;
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
    raw = s->pre;
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

// Snapshot (CONTRACTS §2.5): current state of every control, in record order, as if it had just been sent.
static void snapshot(void) {
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    State *s = &st[i];
    if (c->kind == 1) {
      send_cc(c, s->curV);
      s->lastV = s->curV;
      s->lastS = s->curS;
    } else if (c->kind == 2) {
      if (c->flags & 1) send_onoff(c, s->on);
      else if (s->stable) send_onoff(c, true);  // momentary: only while held
    } else if (c->kind == 3 && !(c->flags & 2)) {
      send_cc(c, s->value);
    }
  }
}

void scan(void) {
  mux_prepass();
  for (int i = 0; i < cfg.controlCount; i++) {
    const CtrlRec *c = &cfg.ctrl[i];
    if (c->kind == 1) scan_analog(c, &st[i]);
    else if (c->kind == 2) scan_button(c, &st[i]);
    else if (c->kind == 3) scan_encoder(c, &st[i]);
  }
  if (snap_req) { snap_req = false; snapshot(); }
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

static void midi_in(uint8_t status, uint8_t d1, uint8_t d2);

// SysEx snapshot request F0 7D 6B 01 F7 (CONTRACTS §2.5), fed byte by byte from USB (CIN 4-7 packets) and from the UART.
// Anything else is ignored without a reply; a status byte inside a SysEx abandons it.
static bool sx_active;
static uint8_t sx_len, sx_buf[4];
static void sysex_byte(uint8_t b) {
  if (b == 0xF0) { sx_active = true; sx_len = 0; return; }
  if (!sx_active) return;
  if (b == 0xF7) {
    sx_active = false;
    if (sx_len == 3 && sx_buf[0] == 0x7D && sx_buf[1] == 0x6B && sx_buf[2] == 0x01) snap_req = true;  // coalesces repeats
  } else if (b & 0x80) {
    sx_active = false;
  } else {
    if (sx_len < 4) sx_buf[sx_len] = b;
    if (sx_len < 255) sx_len++;
  }
}

// USB-MIDI event packet from the host: channel messages (CIN 8-E) or SysEx bytes (CIN 4-7); the rest is ignored.
static void usb_packet(const uint8_t *p) {
  uint8_t cin = p[0] & 0x0F;
  if (cin >= 0x8 && cin <= 0xE) { sx_active = false; midi_in(p[1], p[2], p[3]); return; }
  static const uint8_t sx_n[8] = {0, 0, 0, 0, 3, 1, 2, 3};  // bytes carried by CIN 4..7
  if (cin >= 0x4 && cin <= 0x7) for (int i = 0; i < sx_n[cin]; i++) sysex_byte(p[1 + i]);
  else if (cin == 0x2 || cin == 0x3) sx_active = false;
}

// UART RX: running status accepted, real-time bytes ignored, system messages clear running status.
static uint8_t rx_status, rx_have, rx_need, rx_d[2];
static void port_rx_byte(uint8_t b) {
  if (b >= 0xF8) return;
  if (b == 0xF0 || b == 0xF7 || sx_active) {
    if (b == 0xF0 || b == 0xF7 || !(b & 0x80)) { rx_status = 0; rx_have = 0; sysex_byte(b); return; }
  }
  if (b & 0x80) {
    sx_active = false;
    rx_have = 0;
    rx_status = b >= 0xF0 ? 0 : b;
    rx_need = ((b & 0xE0) == 0xC0) ? 1 : 2;
    return;
  }
  if (!rx_status) return;
  rx_d[rx_have++] = b;
  if (rx_have == rx_need) { midi_in(rx_status, rx_d[0], rx_need == 2 ? rx_d[1] : 0); rx_have = 0; }
}

static uart_inst_t *uart_for_pin(uint8_t p) {
  return (p == 0 || p == 1 || p == 12 || p == 13 || p == 16 || p == 17) ? uart0 : uart1;
}

static void port_init(void) {
  const PortRec *p = cfg.port;
  uint8_t any = p->tx != 0xFF ? p->tx : p->rx;
  if (any == 0xFF) return;
  port_uart = uart_for_pin(any);
  uart_init(port_uart, 31250);
  uart_set_format(port_uart, 8, 1, UART_PARITY_NONE);
  uart_set_fifo_enabled(port_uart, true);
  if (p->tx != 0xFF) gpio_set_function(p->tx, GPIO_FUNC_UART);
  if (p->rx != 0xFF) gpio_set_function(p->rx, GPIO_FUNC_UART);
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
  settle_init();
  mux_tables();
  reads_init();
  adc_init();
  bool adc_used[3] = {0};
  for (int i = 0; i < cfg.muxCount; i++) {
    const MuxRec *m = &cfg.mux[i];
    if (m->en != 0xFF) { gpio_init(m->en); gpio_set_dir(m->en, GPIO_OUT); gpio_put(m->en, 1); }  // start disabled
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
  port_init();
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
    while (tud_midi_n_packet_read(0, pkt)) if (cfg.valid) usb_packet(pkt);
    if (port_uart) {  // polled: at least once per scan wake-up, FIFO holds 32 B = 10 ms of wire time
      while (uart_is_readable(port_uart)) port_rx_byte(uart_getc(port_uart));
      port_drain();
    }
    if (cfg.valid && !started) {
      if (!tud_mounted()) { best_effort_wfe_or_timeout(make_timeout_time_ms(1)); continue; }
      started = true;
      next = time_us_64();
    }
    uint64_t now = time_us_64();
    if (now < next) {
      // While UART TX bytes are queued wake every 400 us to keep its 32-byte FIFO fed (~1 ms of wire time).
      uint64_t wake = (txt != txh && now + 400 < next) ? now + 400 : next;
      best_effort_wfe_or_timeout(from_us_since_boot(wake));
      continue;
    }
    next += 1000;
    if (cfg.valid) scan();
    else gpio_put(LED_PIN, (now / 250000) & 1);  // blink ~2 Hz
  }
}
