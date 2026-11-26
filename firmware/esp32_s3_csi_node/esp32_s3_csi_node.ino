/*
 * ESP32-S3 Wi-Fi CSI (Channel State Information) Ortam & İnsan Takip Node'u
 * -------------------------------------------------------------------------
 * Doğrudan bu projenin Python Hub'ına (UDP Port 5005) veri gönderir ve
 * aynı zamanda ruvnet/RuView (wifi-densepose) & espressif/esp-csi mimarisiyle uyumludur!
 *
 * Kurulum:
 *   - Odaya 3 adet ESP32-S3 (RX_1, RX_2, RX_3) yerleştirip NODE_ID'yi değiştir.
 *   - PC_IP adresini Python sunucusunun çalıştığı bilgisayarın yerel IP'si yap.
 *   - Dijital İkiz arayüzünden Wi-Fi CSI modunu "Canlı ESP32-S3 (UDP:5005)" yap.
 *
 * Alternatif: Tam RuView Rust/Docker motoru için https://github.com/ruvnet/RuView
 * reposundaki resmi ESP32-S3 firmware'ini de direkt flashlayabilirsin (UDP 5005 uyumludur).
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "esp_wifi.h"

const char* WIFI_SSID = "KENDI_WIFI_AGIN";
const char* WIFI_PASS = "KENDI_WIFI_SIFREN";

const char* PC_IP     = "192.168.1.100";  // Python Dijital İkiz sunucusunun IP'si
const uint16_t PC_PORT = 5005;
const char* NODE_ID   = "RX_1";           // Diğer düğümler için "RX_2", "RX_3" yap

WiFiUDP udp;
volatile bool csiReady = false;
int8_t csiCopy[128];
int csiLenCopy = 0;
int8_t lastRssi = -50;
unsigned long lastSendMs = 0;

void IRAM_ATTR onCsiRx(void* ctx, wifi_csi_info_t* data) {
  if (!data || !data->buf || data->len < 20) return;
  if (csiReady) return; // Ana döngü bir öncekini henüz göndermedi

  int n = (data->len > 128) ? 128 : data->len;
  memcpy(csiCopy, data->buf, n);
  csiLenCopy = n;
  lastRssi = data->rx_ctrl.rssi;
  csiReady = true;
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // WIFI_PS_NONE — kesintisiz CSI yakalama için şart
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\n[CSI %s] Wi-Fi Bağlandı! IP: %s\n", NODE_ID, WiFi.localIP().toString().c_str());

  // 802.11n OFDM CSI yakalamayı etkinleştir
  wifi_csi_config_t cfg = {};
  cfg.lltf_en           = true;
  cfg.htltf_en          = true;
  cfg.stbc_htltf2_en    = true;
  cfg.ltf_merge_en      = true;
  cfg.channel_filter_en = true;
  cfg.manu_scale        = false;

  ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
  ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(&onCsiRx, NULL));
  ESP_ERROR_CHECK(esp_wifi_set_csi(true));

  Serial.printf("[CSI %s] UDP:%u portuna 2.4 GHz CSI akışı başlatıldı.\n", NODE_ID, PC_PORT);
}

void loop() {
  // ~25 Hz hızında UDP CSI çerçevesi gönder (router paketlerini tetiklemek için kendi UDP'miz yeterlidir)
  if (csiReady && (millis() - lastSendMs >= 40)) {
    lastSendMs = millis();

    String json;
    json.reserve(640);
    json += "{\"node_id\":\"";
    json += NODE_ID;
    json += "\",\"rssi\":";
    json += String((int)lastRssi);
    json += ",\"csi\":[";

    int maxBytes = min(csiLenCopy, 104); // 52 alt taşıyıcı x 2 (I, Q)
    for (int i = 0; i < maxBytes; i++) {
      if (i > 0) json += ',';
      json += String((int)csiCopy[i]);
    }
    json += "]}";

    udp.beginPacket(PC_IP, PC_PORT);
    udp.print(json);
    udp.endPacket();

    csiReady = false;
  }
}
