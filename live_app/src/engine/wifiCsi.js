/**
 * IEEE 802.11n HT20 Channel 6 (2437 MHz, λ = 12.3 cm) Wi-Fi CSI Physics & Operator Tracker
 * -----------------------------------------------------------------------------------------
 * Serverless in-browser RF propagation engine + optional live WebSocket sync to local
 * RuView / ESP32-S3 UDP:5005 bridge when running on a local machine.
 */

const WIFI_WAVELENGTH_M = 0.123;
const NUM_SUBCARRIERS = 52;
export const ROOM_HALF_W = 2.1;

export class WiFiCSIEngine {
  constructor() {
    this.mode = "simulated"; // "simulated" | "local_ws"
    this.simBehavior = "orbit_observe"; // "orbit_observe" | "inspect_close" | "stationary_breath" | "manual"
    this.liveConnected = false;

    this.nodes = [
      { id: "TX_AP", role: "TX_ROUTER",  pos: [-1.75, 1.35, -1.55], rssiDbm: -30.0, csiVariance: 0.01, fresnelDisturbance: 0.0 },
      { id: "RX_1",  role: "RX_ESP32S3", pos: [ 1.75, 1.15, -1.45], rssiDbm: -34.2, csiVariance: 0.02, fresnelDisturbance: 0.05 },
      { id: "RX_2",  role: "RX_ESP32S3", pos: [ 1.70, 1.15,  1.65], rssiDbm: -38.5, csiVariance: 0.04, fresnelDisturbance: 0.12 },
      { id: "RX_3",  role: "RX_ESP32S3", pos: [-1.70, 1.15,  1.60], rssiDbm: -36.8, csiVariance: 0.03, fresnelDisturbance: 0.08 },
    ];

    this.operator = {
      x: 0.42,
      z: 1.24,
      yaw: Math.PI,
      speed: 0.0,
      posture: "OBSERVING",
      presenceConfidence: 0.94,
      motionEnergy: 0.22,
      breathingBpm: 15.6,
      heartRateBpm: 72,
    };
    this.manualTarget = null;
    this.subcarriersAmp = new Array(NUM_SUBCARRIERS).fill(0.65);
    this.waveFieldSize = 16;
    this.waveField = new Float32Array(16 * 16);
    this._t = 0;

    // Optional live bridge to local RuView/ESP32-S3 WebSocket
    this._ws = null;
    this._liveData = null;
  }

  connectLocalBridge(wsUrl = "ws://127.0.0.1:8765/ws/twin?client=web") {
    this.disconnectLocalBridge();
    this.mode = "local_ws";
    try {
      const ws = new WebSocket(wsUrl);
      this._ws = ws;
      ws.onopen = () => { this.liveConnected = true; };
      ws.onclose = () => { this.liveConnected = false; };
      ws.onerror = () => { this.liveConnected = false; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.wifi_csi) this._liveData = msg.wifi_csi;
        } catch (_) {}
      };
    } catch (_) {
      this.liveConnected = false;
    }
  }

  disconnectLocalBridge() {
    this.mode = "simulated";
    this.liveConnected = false;
    this._liveData = null;
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }
  }

  setBehavior(beh) {
    this.simBehavior = beh;
  }

  setManualOperatorPos(x, z) {
    this.simBehavior = "manual";
    this.manualTarget = [
      Math.max(-ROOM_HALF_W + 0.35, Math.min(ROOM_HALF_W - 0.35, x)),
      Math.max(-ROOM_HALF_W + 0.35, Math.min(ROOM_HALF_W - 0.35, z)),
    ];
  }

  _fresnelDisturbance(tx, rx, px, pz) {
    const dTr = Math.hypot(rx[0] - tx[0], rx[2] - tx[2]);
    const dTp = Math.hypot(px - tx[0], pz - tx[2]);
    const dPr = Math.hypot(rx[0] - px, rx[2] - pz);
    const excess = Math.max(0, dTp + dPr - dTr);
    return Math.exp(-excess / 0.42);
  }

  update(dt) {
    this._t += dt;
    const t = this._t;

    if (this.mode === "local_ws" && this.liveConnected && this._liveData) {
      const src = this._liveData;
      this.operator.x = src.operator.pos[0];
      this.operator.z = src.operator.pos[2];
      this.operator.yaw = src.operator.yaw_rad;
      this.operator.speed = src.operator.speed_mps;
      this.operator.posture = src.operator.posture;
      this.operator.presenceConfidence = src.operator.presence_confidence;
      this.operator.motionEnergy = src.operator.motion_energy;
      this.operator.breathingBpm = src.operator.breathing_bpm;
      this.operator.heartRateBpm = src.operator.heart_rate_bpm;
      if (src.subcarriers_amp) this.subcarriersAmp = src.subcarriers_amp;
      if (src.wave_field) {
        for (let i = 0; i < Math.min(256, src.wave_field.length); i++) this.waveField[i] = src.wave_field[i];
      }
      if (src.nodes) {
        for (const sn of src.nodes) {
          const local = this.nodes.find((n) => n.id === sn.id);
          if (local) {
            local.rssiDbm = sn.rssi_dbm;
            local.fresnelDisturbance = sn.fresnel_disturbance;
            local.csiVariance = sn.csi_variance;
          }
        }
      }
      return;
    }

    const prevX = this.operator.x;
    const prevZ = this.operator.z;
    let txTarget = prevX;
    let tzTarget = prevZ;

    if (this.simBehavior === "orbit_observe") {
      const ang = Math.sin(t * 0.25) * 1.12;
      const rad = 1.32 + 0.16 * Math.sin(t * 0.5);
      txTarget = Math.sin(ang) * rad;
      tzTarget = Math.cos(ang) * rad;
    } else if (this.simBehavior === "inspect_close") {
      txTarget = 0.24 * Math.sin(t * 0.42);
      tzTarget = 0.94 + 0.05 * Math.cos(t * 0.55);
    } else if (this.simBehavior === "stationary_breath") {
      txTarget = 0.48;
      tzTarget = 1.24;
    } else if (this.manualTarget) {
      [txTarget, tzTarget] = this.manualTarget;
    }

    const lerp = Math.min(1, dt * 2.8);
    this.operator.x += (txTarget - this.operator.x) * lerp;
    this.operator.z += (tzTarget - this.operator.z) * lerp;

    // Keep operator cleanly outside the workbench perimeter
    if (Math.abs(this.operator.x) < 0.65 && Math.abs(this.operator.z) < 0.58) {
      this.operator.z = this.operator.z >= 0 ? 0.74 : -0.74;
    }

    const vx = (this.operator.x - prevX) / Math.max(dt, 1e-4);
    const vz = (this.operator.z - prevZ) / Math.max(dt, 1e-4);
    this.operator.speed = Math.hypot(vx, vz);
    this.operator.yaw = Math.atan2(-this.operator.x, -this.operator.z);

    this.operator.posture =
      this.operator.speed > 0.16
        ? "WALKING"
        : Math.hypot(this.operator.x, this.operator.z) < 1.06
        ? "INSPECTING"
        : "OBSERVING";

    this.operator.breathingBpm = Number((15.6 + 0.65 * Math.sin(t * 0.18)).toFixed(1));
    this.operator.heartRateBpm = Math.round(72 + 3 * Math.sin(t * 0.13) + this.operator.speed * 7.5);
    const breathWave = 0.012 * Math.sin(2 * Math.PI * (this.operator.breathingBpm / 60) * t);

    const txPos = this.nodes[0].pos;
    let maxFresnel = 0;

    for (let i = 1; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const f = this._fresnelDisturbance(txPos, node.pos, this.operator.x, this.operator.z);
      const dLink = Math.max(0.5, Math.hypot(node.pos[0] - txPos[0], node.pos[2] - txPos[2]));
      const fsplDb = 40.05 + 20 * Math.log10(dLink);
      const doppler = Math.min(0.45, this.operator.speed * 0.55) + Math.abs(breathWave) * 8.0;
      const dist = Math.min(1, f * (0.45 + doppler));
      node.fresnelDisturbance = Number(dist.toFixed(3));
      node.csiVariance = Number((0.015 + dist * 0.42).toFixed(4));
      node.rssiDbm = Number((17.0 - fsplDb - 7.5 * f + Math.sin(t * 3.1 + i * 2.1) * 0.4).toFixed(1));
      if (dist > maxFresnel) maxFresnel = dist;
    }

    this.operator.motionEnergy = Number(Math.min(1, 0.1 + this.operator.speed * 1.1 + Math.abs(breathWave) * 6).toFixed(3));
    this.operator.presenceConfidence = Number(Math.min(0.99, 0.85 + maxFresnel * 0.14).toFixed(3));

    // 52-subcarrier 802.11n OFDM frequency-selective multipath response
    const dOp = Math.hypot(this.operator.x - txPos[0], this.operator.z - txPos[2]) + Math.hypot(this.operator.x, this.operator.z);
    for (let k = 0; k < NUM_SUBCARRIERS; k++) {
      const fOff = (k - NUM_SUBCARRIERS / 2) * 0.3125e6;
      const phStatic = 2 * Math.PI * fOff * (dOp / 3e8);
      const phDyn = ((2 * Math.PI) / WIFI_WAVELENGTH_M) * (0.24 * Math.sin(t * 1.7) * this.operator.speed + breathWave);
      const re = 0.68 + 0.26 * maxFresnel * Math.cos(phStatic + phDyn + k * 0.11) + 0.08 * Math.cos(k * 0.37);
      const im = 0.26 * maxFresnel * Math.sin(phStatic + phDyn + k * 0.11) + 0.08 * Math.sin(k * 0.37);
      this.subcarriersAmp[k] = Math.max(0.06, Math.min(1, Math.hypot(re, im)));
    }

    // 16x16 smooth floor spatial disturbance matrix
    const n = this.waveFieldSize;
    let idx = 0;
    for (let gz = 0; gz < n; gz++) {
      const wz = -ROOM_HALF_W + ((gz + 0.5) * (2 * ROOM_HALF_W)) / n;
      for (let gx = 0; gx < n; gx++) {
        const wx = -ROOM_HALF_W + ((gx + 0.5) * (2 * ROOM_HALF_W)) / n;
        const dTx = Math.hypot(wx - txPos[0], wz - txPos[2]);
        const carrier = 0.5 + 0.5 * Math.sin(dTx * 5.2 - t * 4.2);
        const atten = 1 / (1 + 0.22 * dTx * dTx);
        const dP = Math.hypot(wx - this.operator.x, wz - this.operator.z);
        const scatter = Math.exp(-(dP * dP) / 0.36) * (0.65 + 0.35 * Math.sin(dP * 9 - t * 5));
        this.waveField[idx++] = Math.min(1, carrier * atten * 0.42 + scatter * 0.85);
      }
    }
  }
}
