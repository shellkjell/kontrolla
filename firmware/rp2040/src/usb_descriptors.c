#include "pico/unique_id.h"
#include "tusb.h"

// Set by main() from the config blob before tusb_init().
const char *g_product = "kont.rolla (no config)";

static const tusb_desc_device_t desc_device = {
    .bLength = sizeof(tusb_desc_device_t), .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0200, .bDeviceClass = 0, .bDeviceSubClass = 0, .bDeviceProtocol = 0,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = 0x1209, .idProduct = 0x0001, .bcdDevice = 0x0100,
    .iManufacturer = 1, .iProduct = 2, .iSerialNumber = 3, .bNumConfigurations = 1};

enum { ITF_AUDIO_CTRL, ITF_MIDI, ITF_TOTAL };
#define EPNUM_MIDI_OUT 0x01
#define EPNUM_MIDI_IN 0x81

static const uint8_t desc_cfg[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_TOTAL, 0, TUD_CONFIG_DESC_LEN + TUD_MIDI_DESC_LEN, 0, 100),
    TUD_MIDI_DESCRIPTOR(ITF_AUDIO_CTRL, 0, EPNUM_MIDI_OUT, EPNUM_MIDI_IN, 64)};

const uint8_t *tud_descriptor_device_cb(void) { return (const uint8_t *)&desc_device; }
const uint8_t *tud_descriptor_configuration_cb(uint8_t i) { (void)i; return desc_cfg; }

static uint16_t str[34];
const uint16_t *tud_descriptor_string_cb(uint8_t idx, uint16_t langid) {
  (void)langid;
  const char *s;
  char serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];
  uint8_t n;
  if (idx == 0) { str[1] = 0x0409; n = 1; goto done; }
  if (idx == 1) s = "kont.rolla";
  else if (idx == 2) s = g_product;
  else if (idx == 3) { pico_get_unique_board_id_string(serial, sizeof serial); s = serial; }
  else return NULL;
  for (n = 0; n < 32 && s[n]; n++) str[1 + n] = s[n];
done:
  str[0] = (TUSB_DESC_STRING << 8) | (2 * n + 2);
  return str;
}
