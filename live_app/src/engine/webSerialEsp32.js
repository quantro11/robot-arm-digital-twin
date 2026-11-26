/**
 * Direct Browser -> Physical ESP32 USB Serial Controller (Web Serial API)
 * -----------------------------------------------------------------------
 * Works directly in Chrome / Edge over HTTPS (GitHub Pages) with ZERO Python server!
 * Protocol matches firmware/esp32_arm_controller/esp32_arm_controller.ino @ 115200 baud:
 *   TX: {"cmd":"SET_JOINTS","j":[j1,j2,j3,j4,j5,j6]}\n
 *   RX: {"j":[...],"vbus":5.98,"estop":false}\n
 */

export class WebSerialESP32 {
  constructor(onLog = () => {}) {
    this.supported = typeof navigator !== "undefined" && "serial" in navigator;
    this.connected = false;
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.hwTelemetry = null;
    this.packetsSent = 0;
    this.packetsRx = 0;
    this._lastTxMs = 0;
    this._onLog = onLog;
    this._encoder = new TextEncoder();
  }

  async connect() {
    if (!this.supported) {
      this._onLog("ESP32", "Web Serial API için Chrome veya Edge tarayıcı gereklidir.");
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable.getWriter();
      this.connected = true;
      this._onLog("ESP32", "Fiziksel ESP32 USB Serial bağlantısı kuruldu (115200 baud, Sunucusuz!)");
      this._startReadLoop();
      return true;
    } catch (err) {
      this._onLog("ESP32", `Bağlantı iptal edildi veya hata: ${err.message}`);
      return false;
    }
  }

  async disconnect() {
    this.connected = false;
    try {
      if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); }
      if (this.writer) { this.writer.releaseLock(); }
      if (this.port) { await this.port.close(); }
    } catch (_) {}
    this.reader = null;
    this.writer = null;
    this.port = null;
    this._onLog("ESP32", "ESP32 USB bağlantısı kapatıldı (Simülasyon Modu).");
  }

  async sendJoints(joints, nowMs) {
    if (!this.connected || !this.writer) return;
    if (nowMs - this._lastTxMs < 25) return; // 40 Hz throttle
    this._lastTxMs = nowMs;
    const msg = JSON.stringify({
      cmd: "SET_JOINTS",
      j: [
        Number(joints.j1_base.toFixed(1)),
        Number(joints.j2_shoulder.toFixed(1)),
        Number(joints.j3_elbow.toFixed(1)),
        Number(joints.j4_wrist_pitch.toFixed(1)),
        Number(joints.j5_wrist_roll.toFixed(1)),
        Number(joints.j6_gripper.toFixed(1)),
      ],
    }) + "\n";
    try {
      await this.writer.write(this._encoder.encode(msg));
      this.packetsSent++;
    } catch (_) {
      await this.disconnect();
    }
  }

  async _startReadLoop() {
    const decoder = new TextDecoderStream();
    const pipeDone = this.port.readable.pipeTo(decoder.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buffer = "";
    try {
      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.startsWith("{")) {
            try {
              this.hwTelemetry = JSON.parse(line);
              this.packetsRx++;
            } catch (_) {}
          }
        }
      }
    } catch (_) {
    } finally {
      await pipeDone;
    }
  }
}
