# Unreal Engine 5 (Lumen / RTX 4060) Kurulum ve Canlı Bağlantı Rehberi

Bilgisayarında **NVIDIA GeForce RTX 4060** ve **Epic Games Launcher** halihazırda mevcut. Unreal Engine 5 motorunu indirdikten sonra bu projedeki Python arka ucunu (OpenCV + ESP32 + Wi-Fi CSI) **birebir gerçek zamanlı** olarak UE5 içine bağlamak sadece 5 dakika sürer.

---

## 1. Unreal Engine 5 Kurulumu
1. **Epic Games Launcher**'ı aç → **Unreal Engine → Library → Engine Versions (+)** → **UE 5.4** veya **UE 5.5** yükle.
2. Yeni proje oluştur: **Games → Blank → C++ → Maximum Quality + Raytracing / Lumen aktif** (örnek ad: `RobotArmTwinUE5`).

## 2. UE5 C++ Modüllerini Etkinleştir
UE5 projenin `Source/RobotArmTwinUE5/RobotArmTwinUE5.Build.cs` dosyasını aç ve `PublicDependencyModuleNames` içine şu standart yerleşik modülleri ekle (ücretli eklenti gerekmez):

```csharp
PublicDependencyModuleNames.AddRange(new string[] {
    "Core", "CoreUObject", "Engine", "InputCore",
    "WebSockets", "Json", "JsonUtilities", "HTTP", "ImageWrapper"
});
```

## 3. Hazır C++ Dijital İkiz Aktörünü Ekle
Bu klasördeki iki dosyayı UE5 projenin `Source/RobotArmTwinUE5/` dizinine kopyala:
- `RobotArmDigitalTwinActor.h`
- `RobotArmDigitalTwinActor.cpp`

*(Eğer API makrosu gerekirse `class ARobotArmDigitalTwinActor` satırını `class ROBOTARMTWINUE5_API ARobotArmDigitalTwinActor` yapıp derle.)*

## 4. Laboratuvar Sahnesini Otomatik Oluştur
1. UE5 içinde **Edit → Plugins → Python Editor Script Plugin** eklentisini aç.
2. **Tools → Execute Python Script** menüsünden `unreal_bridge/setup_ue5_scene.py` dosyasını seçip çalıştır.
3. Sahne otomatik olarak **Lumen ışıkları, çalışma masası, ESP32-CAM gantrisi, 4 ayrıştırma bölgesi ve Wi-Fi CSI düğümleriyle** oluşacaktır.
4. 3D baskı robot kolunun `.STL` veya `.FBX` parçalarını UE5'e sürükle-bırak yapıp `J1_BasePivot .. J6_RightJaw` bileşenlerine bağla.

## 5. Canlı Bağlantı & RTX 4060 Optimizasyonu
1. Önce Python sunucusunu başlat (`python backend/server.py`).
2. UE5 sahnesine `RobotArmDigitalTwinActor` aktörünü koy (WebSocket URL varsayılan olarak `ws://127.0.0.1:8765/ws/twin?client=ue5`).
3. **Play (Alt+P)** tuşuna bas!
   - Üstteki Web arayüzünde `UE5: BAĞLI (1)` ışığı yeşile döner.
   - 6 eklem açısı, küp özellikleri (`ActiveCube`), canlı OpenCV kamera dokusu (`LiveCameraTexture`) ve Wi-Fi CSI operatör konumu (`WiFiCSI`) **30 Hz** akmaya başlar.
4. **Wi-Fi Dalga Görselleştirme (Niagara):** `WiFiCSI.SubcarrierAmplitudes` dizisini bir **Niagara Particle System**'e bağlayarak odada fotogerçekçi parlayan RF dalga halkaları oluşturabilirsin; operatör için ise **MetaHuman** veya yarı saydam holografik materyal atanmış `Mannequin` kullanabilirsin.
