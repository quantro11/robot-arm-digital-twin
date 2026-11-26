# 6-DOF Görüntü İşlemeli Robot Kol • Canlı Dijital İkiz & Wi-Fi CSI Lab

> **Canlı Demo (Sunucusuz — Okul Bilgisayarında Kurulumsuz Çalışır!):**
> - **Cloudflare Workers (HTTPS):** https://robot-arm-digital-twin.farukhilmi-lab.workers.dev/
> - **GitHub Pages (HTTPS):** https://quantro11.github.io/robot-arm-digital-twin/
> - **İnternetsiz / USB Tek Dosya Sürümü:** `RobotKol_TekTikla.html` dosyasına doğrudan çift tıkla (0 sunucu, 0 internet!)

Elektrik-Elektronik Mühendisliği projesi için geliştirilmiş; **sunucu açmadan doğrudan tarayıcıda çalışan** sinematik **GTAO PBR + Gerçek Zemin Yansımalı 3D Dijital İkiz**, **Gerçek Zamanlı Tarayıcı İçi Görüntü İşleme (3D OV2640 Lens / Webcam / ESP32-CAM)**, **IEEE 802.11n Wi-Fi CSI Ortam & Operatör Takibi (`ruvnet/RuView` & `espressif/esp-csi` uyumlu)** ve **Web Serial API ile Doğrudan USB ESP32 Kontrol** platformu.

## Öne Çıkan Özellikler
- **0 Kurulum, 0 Sunucu:** Canlı linke tıklayarak herhangi bir okul bilgisayarında (Chrome/Edge) anında tam ekran açılır.
- **Stüdyo Fotogerçekçilik (`Three.js` + `GTAOPass` + `Reflector` + Studio HDRI + `UnrealBloomPass` + `SMAAPass`):** Gündüz Stüdyo Laboratuvarı ve Gece RF Analiz ışıklandırma modları + 60 FPS / Ultra (GTAO) geçişi.
- **Doğrudan USB ESP32 Kontrolü (Web Serial API):** Hiç Python sunucusu çalıştırmadan Chrome/Edge üzerinden USB kablo ile fiziksel ESP32 + PCA9685 + 6 servoya 40 Hz canlı açı gönderir ve voltaj/E-Stop telemetrisi alır.
- **Canlı Görüntü İşleme (Küp Analizi):** Renk (RGB/HSV), boyut (mm), hacim, tahmini ağırlık (g), 3D konum (X, Y, Z), dönme açısı (Yaw) ve güven (%) değerlerini canlı 3D OV2640 lensinden, gerçek PC Webcam'den veya ESP32-CAM'den okur.
- **3D Baskı `.STL` Önizleyici:** Kendi 3D yazıcı parçanı doğrudan çalışma masasında gerçek PLA dokusuyla incele.

## Klasör Yapısı
- `live_app/` — Canlı yayınlanan sunucusuz Vite + Three.js GTAO PBR uygulaması.
- `firmware/` — Arduino/ESP32 kaynak kodları (`esp32_arm_controller.ino`, `esp32_cam_streamer.ino`, `esp32_s3_csi_node.ino`).
- `docs/PROJE_REHBERI.md` — Detaylı Malzeme Listesi (BOM), Tork & Güç Hesapları, Pinout Bağlantı Şeması ve 3D Baskı Kol Önerileri.
- `backend/` — Opsiyonel yerel Python OpenCV + ESP32-S3 UDP:5005 + UE5 köprüsü.
- `unreal_bridge/` — Opsiyonel Unreal Engine 5 C++ WebSocket Aktörleri ve sahne otomasyon betiği.
