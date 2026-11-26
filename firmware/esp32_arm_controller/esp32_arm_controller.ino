/*
 * 6-DOF 3D Baskı Robot Kol — ESP32 Servo Kontrol & Telemetri Yazılımı
 * -------------------------------------------------------------------
 * Donanım:
 *   - ESP32 DevKit V1 (veya ESP32-S3)
 *   - PCA9685 16-Kanal I2C PWM Sürücü (SDA=GPIO21, SCL=GPIO22)  [ÖNERİLEN]
 *   - 3x DS3218 / MG996R (J1 Taban, J2 Omuz, J3 Dirsek)
 *   - 3x MG90S / MG996R  (J4 Bilek Eğim, J5 Bilek Dönüş, J6 Kıskaç)
 *   - Harici 5V-6V 5A UBEC / Adaptör (ORTAK GND zorunlu!)
 *
 * Gerekli Arduino Kütüphaneleri:
 *   - ArduinoJson (v7+)
 *   - Adafruit PWM Servo Driver Library (USE_PCA9685 = 1 için)
 *   - ESP32Servo (USE_PCA9685 = 0 doğrudan pin sürüşü için)
 *
 * Python Dijital İkiz Haberleşme Protokolü (USB Serial @ 115200 baud):
 *   Gelen komut : {"cmd":"SET_JOINTS","j":[0.0,-14.0,98.0,96.0,0.0,72.0]}
 *   Giden durum : {"j":[0.0,-14.0,98.0,96.0,0.0,72.0],"vbus":5.98,"estop":false}
 */

#include <Arduino.h>
#include <Wire.h>
#include <ArduinoJson.h>

#define USE_PCA9685 1
#define ESTOP_PIN   4     // Acil durdurma butonu (GND'ye çekilince aktif)
#define VBUS_ADC    34    // Opsiyonel 2:1 gerilim bölücü ile 6V bara ölçümü

#if USE_PCA9685
  #include <Adafruit_PWMServoDriver.h>
  Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
  #define SERVO_MIN_US 500
  #define SERVO_MAX_US 2500
#else
  #include <ESP32Servo.h>
  Servo servos[6];
  const int SERVO_PINS[6] = {13, 12, 14, 27, 26, 25};
#endif

// Her eklemin mekanik sıfır (kalibrasyon) ofseti ve yönü (+1 veya -1)
// Python kinematics.py SERVO_HW_SPEC ile birebir uyumludur (180° servo sınırına çarpmaz!)
const float SERVO_CENTER_DEG[6] = { 90.0, 90.0, 35.0, 45.0, 90.0, 10.0 };
const float SERVO_DIR[6]        = {  1.0,  1.0,  1.0,  1.0,  1.0,  1.0 };

float currentDeg[6] = { 0.0, -14.0, 98.0, 96.0, 0.0, 72.0 };
float targetDeg[6]  = { 0.0, -14.0, 98.0, 96.0, 0.0, 72.0 };

String rxBuffer;
unsigned long lastServoTick = 0;
unsigned long lastTelTick   = 0;

void writeServoAngle(int ch, float logicalDeg) {
  float physDeg = SERVO_CENTER_DEG[ch] + SERVO_DIR[ch] * logicalDeg;
  physDeg = constrain(physDeg, 0.0f, 180.0f);

#if USE_PCA9685
  float pulseUs = SERVO_MIN_US + (physDeg / 180.0f) * (SERVO_MAX_US - SERVO_MIN_US);
  // 50Hz => 20000us period, 12-bit resolution (4096 ticks)
  uint16_t ticks = (uint16_t)((pulseUs / 20000.0f) * 4096.0f);
  pwm.setPWM(ch, 0, ticks);
#else
  servos[ch].write((int)roundf(physDeg));
#endif
}

void processSerialLine(const String& line) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) return;

  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "SET_JOINTS") == 0) {
    JsonArray arr = doc["j"].as<JsonArray>();
    if (arr.size() >= 6) {
      for (int i = 0; i < 6; i++) {
        targetDeg[i] = arr[i].as<float>();
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(ESTOP_PIN, INPUT_PULLUP);
  analogReadResolution(12);

#if USE_PCA9685
  Wire.begin(21, 22);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  delay(20);
#else
  for (int i = 0; i < 6; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2500);
  }
#endif

  for (int i = 0; i < 6; i++) {
    writeServoAngle(i, currentDeg[i]);
  }
}

void loop() {
  // 1. Python Dijital İkiz'den gelen JSON komut satırlarını oku
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      rxBuffer.trim();
      if (rxBuffer.length() > 2) {
        processSerialLine(rxBuffer);
      }
      rxBuffer = "";
    } else if (rxBuffer.length() < 256) {
      rxBuffer += c;
    }
  }

  bool estop = (digitalRead(ESTOP_PIN) == LOW);
  unsigned long now = millis();

  // 2. 50 Hz Yumuşak Rampa Enterpolasyonu (PLA gövdeyi ve servoları sarsıntıdan korur)
  if (!estop && (now - lastServoTick >= 20)) {
    lastServoTick = now;
    const float maxStepDeg = 3.2f; // 160 deg/s maksimum yumuşak hız
    for (int i = 0; i < 6; i++) {
      float diff = targetDeg[i] - currentDeg[i];
      if (fabsf(diff) <= maxStepDeg) {
        currentDeg[i] = targetDeg[i];
      } else {
        currentDeg[i] += (diff > 0 ? maxStepDeg : -maxStepDeg);
      }
      writeServoAngle(i, currentDeg[i]);
    }
  }

  // 3. 25 Hz Gerçek Zamanlı Telemetri Geri Bildirimi
  if (now - lastTelTick >= 40) {
    lastTelTick = now;
    // 2:1 gerilim bölücü varsayımı (R1=10k, R2=10k)
    float adcVolt = (analogRead(VBUS_ADC) / 4095.0f) * 3.3f * 2.0f;
    float vbus = (adcVolt > 2.5f) ? adcVolt : 6.00f;

    JsonDocument out;
    JsonArray jArr = out["j"].to<JsonArray>();
    for (int i = 0; i < 6; i++) jArr.add(roundf(currentDeg[i] * 10.0f) / 10.0f);
    out["vbus"] = roundf(vbus * 100.0f) / 100.0f;
    out["estop"] = estop;
    serializeJson(out, Serial);
    Serial.println();
  }
}
