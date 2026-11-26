import { MissionController } from "./engine/mission.js";
import { BrowserVisionEngine } from "./engine/vision.js";
import { WiFiCSIEngine } from "./engine/wifiCsi.js";
import { WebSerialESP32 } from "./engine/webSerialEsp32.js";
import { RoboticsLabScene } from "./scene/labScene.js";

// ---------------------------------------------------------------------------
// 1. Initialize 100% Serverless Core Engines + Photorealistic 3D Studio Lab
// ---------------------------------------------------------------------------
const logs = [];
function addLog(tag, msg) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  logs.push({ time, tag, msg });
  if (logs.length > 35) logs.shift();
  const box = document.getElementById("logBox");
  if (box) {
    box.innerHTML = logs
      .slice()
      .reverse()
      .map((l) => `<div class="log-line"><span class="t">[${l.time}]</span> <span class="tag">${l.tag}</span> ${l.msg}</div>`)
      .join("");
  }
}

const lab = new RoboticsLabScene(document.getElementById("viewport"));
const mission = new MissionController(addLog);
const vision = new BrowserVisionEngine(document.getElementById("visionCanvas"));
const csi = new WiFiCSIEngine();
const esp32 = new WebSerialESP32(addLog);

addLog("SYSTEM", "Sunucusuz Canlı Dijital İkiz (GTAO PBR + Gerçek Görüntü İşleme + WebSerial ESP32) hazır!");

// ---------------------------------------------------------------------------
// 2. Build 6-DOF Joint Sliders
// ---------------------------------------------------------------------------
const JOINT_META = [
  { key: "j1_base", label: "J1 Taban (DS3218)", min: -135, max: 135 },
  { key: "j2_shoulder", label: "J2 Omuz (DS3218)", min: -75, max: 82 },
  { key: "j3_elbow", label: "J3 Dirsek (DS3218)", min: -110, max: 125 },
  { key: "j4_wrist_pitch", label: "J4 Bilek Eğim (MG996R)", min: -100, max: 100 },
  { key: "j5_wrist_roll", label: "J5 Bilek Dönüş (MG90S)", min: -180, max: 180 },
  { key: "j6_gripper", label: "J6 Kıskaç (MG90S)", min: 0, max: 90 },
];

const sliderWrap = document.getElementById("jointSliders");
const jointSliders = {};
const jointVals = {};
let draggingSlider = false;

for (const jm of JOINT_META) {
  const row = document.createElement("div");
  row.className = "slider-row";
  row.innerHTML = `
    <div class="slider-head"><span>${jm.label}</span><span id="val_${jm.key}">0°</span></div>
    <input type="range" id="sl_${jm.key}" min="${jm.min}" max="${jm.max}" step="1" value="0" />
  `;
  sliderWrap.appendChild(row);
  const sl = row.querySelector("input");
  const vl = row.querySelector(`#val_${jm.key}`);
  jointSliders[jm.key] = sl;
  jointVals[jm.key] = vl;

  sl.addEventListener("pointerdown", () => { draggingSlider = true; });
  sl.addEventListener("pointerup", () => { draggingSlider = false; });
  sl.addEventListener("input", () => {
    vl.textContent = `${sl.value}°`;
    mission.setManualJoint(jm.key, Number(sl.value));
  });
}

// ---------------------------------------------------------------------------
// 3. Wi-Fi CSI 52-Subcarrier Spectrum & Interactive 2D Room Radar Pad
// ---------------------------------------------------------------------------
const csiChart = document.getElementById("csiChart");
const csiCtx = csiChart.getContext("2d");

function drawCSISpectrum(amps) {
  const w = csiChart.width, h = csiChart.height;
  csiCtx.clearRect(0, 0, w, h);
  csiCtx.strokeStyle = "rgba(148,163,184,0.12)";
  csiCtx.lineWidth = 1;
  for (let y = 18; y < h; y += 22) {
    csiCtx.beginPath(); csiCtx.moveTo(0, y); csiCtx.lineTo(w, y); csiCtx.stroke();
  }
  const grad = csiCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(34, 211, 238, 0.44)");
  grad.addColorStop(1, "rgba(20, 184, 166, 0.02)");

  csiCtx.beginPath();
  amps.forEach((a, i) => {
    const x = (i / (amps.length - 1)) * w;
    const y = h - 7 - a * (h - 16);
    if (i === 0) csiCtx.moveTo(x, y); else csiCtx.lineTo(x, y);
  });
  csiCtx.strokeStyle = "#22d3ee";
  csiCtx.lineWidth = 2;
  csiCtx.stroke();
  csiCtx.lineTo(w, h); csiCtx.lineTo(0, h); csiCtx.closePath();
  csiCtx.fillStyle = grad; csiCtx.fill();
}

const roomPad = document.getElementById("roomPad");
const padCtx = roomPad.getContext("2d");

function drawRoomPad() {
  const w = roomPad.width, h = roomPad.height;
  padCtx.clearRect(0, 0, w, h);
  const toC = (rx, rz) => [((rx + 2.1) / 4.2) * w, ((rz + 2.1) / 4.2) * h];

  padCtx.strokeStyle = "rgba(56,189,248,0.12)";
  for (let i = 1; i < 4; i++) {
    padCtx.beginPath(); padCtx.moveTo((w * i) / 4, 0); padCtx.lineTo((w * i) / 4, h); padCtx.stroke();
    padCtx.beginPath(); padCtx.moveTo(0, (h * i) / 4); padCtx.lineTo(w, (h * i) / 4); padCtx.stroke();
  }

  const [tx1, tz1] = toC(-0.52, -0.22);
  const [tx2, tz2] = toC(0.52, 0.52);
  padCtx.fillStyle = "rgba(30, 41, 59, 0.9)";
  padCtx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  padCtx.fillRect(tx1, tz1, tx2 - tx1, tz2 - tz1);
  padCtx.strokeRect(tx1, tz1, tx2 - tx1, tz2 - tz1);
  padCtx.fillStyle = "#94a3b8";
  padCtx.font = "9px Consolas";
  padCtx.fillText("ROBOT MASA", tx1 + 7, (tz1 + tz2) / 2 + 3);

  const txNode = csi.nodes[0];
  const [ax, az] = toC(txNode.pos[0], txNode.pos[2]);
  for (const n of csi.nodes) {
    const [nx, nz] = toC(n.pos[0], n.pos[2]);
    if (n.role !== "TX_ROUTER") {
      padCtx.strokeStyle = `rgba(34,211,238,${0.25 + n.fresnelDisturbance * 0.65})`;
      padCtx.beginPath(); padCtx.moveTo(ax, az); padCtx.lineTo(nx, nz); padCtx.stroke();
    }
    padCtx.fillStyle = n.role === "TX_ROUTER" ? "#f59e0b" : "#38bdf8";
    padCtx.beginPath(); padCtx.arc(nx, nz, 4, 0, Math.PI * 2); padCtx.fill();
    padCtx.fillStyle = "#cbd5e1";
    padCtx.fillText(n.id, nx + 5, nz + 3);
  }

  const [ox, oz] = toC(csi.operator.x, csi.operator.z);
  padCtx.fillStyle = "rgba(34, 211, 238, 0.25)";
  padCtx.beginPath(); padCtx.arc(ox, oz, 12, 0, Math.PI * 2); padCtx.fill();
  padCtx.fillStyle = "#22d3ee";
  padCtx.beginPath(); padCtx.arc(ox, oz, 5, 0, Math.PI * 2); padCtx.fill();
  padCtx.fillStyle = "#f8fafc";
  padCtx.fillText("SEN", ox + 8, oz + 3);
}

let draggingPad = false;
function moveOpFromPad(e) {
  const r = roomPad.getBoundingClientRect();
  csi.setManualOperatorPos(((e.clientX - r.left) / r.width) * 4.2 - 2.1, ((e.clientY - r.top) / r.height) * 4.2 - 2.1);
}
roomPad.addEventListener("pointerdown", (e) => { draggingPad = true; moveOpFromPad(e); });
window.addEventListener("pointerup", () => { draggingPad = false; });
roomPad.addEventListener("pointermove", (e) => { if (draggingPad) moveOpFromPad(e); });

// ---------------------------------------------------------------------------
// 4. UI Controls, Lighting Theme, Quality Toggle, WebSerial & STL Upload
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-cam]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-cam]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    lab.flyCamera(btn.dataset.cam);
  });
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`pane-${btn.dataset.tab}`).classList.add("active");
  });
});

document.getElementById("btnTheme").addEventListener("click", (e) => {
  const next = lab.lightingTheme === "studio" ? "night" : "studio";
  lab.setLightingTheme(next);
  e.target.textContent = next === "studio" ? "Gece RF" : "Gündüz Lab";
  addLog("LIGHT", next === "studio" ? "Stüdyo Gündüz Laboratuvarı ışıklandırması aktif." : "Gece RF Analiz ışıklandırması aktif.");
});

document.getElementById("btnPause").addEventListener("click", (e) => {
  mission.paused = !mission.paused;
  e.target.textContent = mission.paused ? "Devam Et" : "Duraklat";
});
document.getElementById("btnResetCubes").addEventListener("click", () => mission.resetCubes());
document.getElementById("btnModeAuto").addEventListener("click", () => mission.setMode("auto_pick_place"));
document.getElementById("btnModeManual").addEventListener("click", () => mission.setMode("manual_joints"));
document.getElementById("btnGoHome").addEventListener("click", () => mission.goHome());

document.getElementById("speedSlider").addEventListener("input", (e) => {
  mission.speedMultiplier = Number(e.target.value);
  document.getElementById("speedVal").textContent = `${mission.speedMultiplier.toFixed(1)}x`;
});

document.querySelectorAll("[data-camsrc]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("[data-camsrc]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.camsrc;
    document.getElementById("espCamUrlWrap").style.display = mode === "esp32cam" ? "flex" : "none";
    const res = await vision.setSource(mode, document.getElementById("espCamUrl").value);
    if (!res.ok) addLog("CAMERA", `Kamera açılamadı (${res.error}) — 3D Lens aktif.`);
    else addLog("CAMERA", `Kamera kaynağı değiştirildi: ${mode.toUpperCase()}`);
  });
});
document.getElementById("btnApplyCamUrl").addEventListener("click", () => {
  vision.setSource("esp32cam", document.getElementById("espCamUrl").value);
});

document.querySelectorAll("[data-csimode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-csimode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.csimode === "local_ws") {
      csi.connectLocalBridge();
      addLog("WIFI_CSI", "Yerel RuView/ESP32-S3 köprüsü (localhost:8765) deneniyor...");
    } else {
      csi.disconnectLocalBridge();
      addLog("WIFI_CSI", "Sunucusuz fiziksel 802.11n Wi-Fi CSI simülatörü aktif.");
    }
  });
});

document.querySelectorAll("[data-csibeh]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-csibeh]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    csi.setBehavior(btn.dataset.csibeh);
  });
});

// Direct Web Serial USB ESP32 Connect/Disconnect
const btnWsConn = document.getElementById("btnWebSerialConnect");
const btnWsDisc = document.getElementById("btnWebSerialDisconnect");
btnWsConn.addEventListener("click", async () => {
  const ok = await esp32.connect();
  if (ok) {
    btnWsConn.style.display = "none";
    btnWsDisc.style.display = "inline-flex";
  }
});
btnWsDisc.addEventListener("click", async () => {
  await esp32.disconnect();
  btnWsConn.style.display = "inline-flex";
  btnWsDisc.style.display = "none";
});

// Custom 3D-Printed .STL Upload onto Workbench
document.getElementById("stlFileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  lab.loadCustomSTL(buf);
  addLog("CAD/STL", `3D baskı modeli yüklendi: ${file.name} (masanın sağ arka tarafında önizleniyor).`);
});

// Bottom Layer & Quality Toggles
function bindToggle(id, obj) {
  const el = document.getElementById(id);
  el.addEventListener("click", () => {
    const on = el.classList.toggle("on");
    obj.visible = on;
  });
}
bindToggle("togWaves", lab.csiWaveGroup);
bindToggle("togLinks", lab.csiLinksGroup);
bindToggle("togRoom", lab.roomGroup);
bindToggle("togCamCone", lab.camCone);

document.getElementById("togUltra").addEventListener("click", (e) => {
  const on = e.target.classList.toggle("on");
  lab.setUltraQuality(on);
  e.target.textContent = on ? "Ultra (GTAO)" : "Hızlı 60FPS";
});

document.getElementById("togHud").addEventListener("click", (e) => {
  const hidden = document.body.classList.toggle("hud-hidden");
  e.target.classList.toggle("on", hidden);
});

// ---------------------------------------------------------------------------
// 5. Real-Time 60 FPS Simulation, Vision & Telemetry Render Loop
// ---------------------------------------------------------------------------
let lastFrameMs = performance.now();
let lastVisionMs = 0;
let lastUiMs = 0;
let elapsed = 0;

function updateHUD(fk, electrical) {
  document.getElementById("missionPhase").textContent = mission.phase;
  document.getElementById("sortedCount").textContent = mission.sortedCount;
  document.getElementById("tipCoords").textContent =
    `${(fk.tip[0] * 100).toFixed(1)}, ${(fk.tip[1] * 100).toFixed(1)}, ${(fk.tip[2] * 100).toFixed(1)} cm`;

  const pillCam = document.getElementById("pillCam");
  pillCam.innerHTML = `<span class="dot"></span>CAM: ${vision.sourceMode === "virtual3d" ? "3D LENS" : vision.sourceMode.toUpperCase()}`;

  const pillEsp = document.getElementById("pillEsp");
  pillEsp.className = `pill ${esp32.connected ? "online" : "sim"}`;
  pillEsp.innerHTML = `<span class="dot"></span>ESP32: ${esp32.connected ? "USB CANLI" : "SİM"}`;

  const pillCsi = document.getElementById("pillCsi");
  pillCsi.className = `pill ${csi.liveConnected ? "online" : "sim"}`;
  pillCsi.innerHTML = `<span class="dot"></span>CSI: ${csi.liveConnected ? "CANLI" : "SİM"}`;

  document.getElementById("camFpsBadge").textContent = `${vision.fps.toFixed(1)} FPS`;

  const ac = vision.activeCube;
  if (ac) {
    document.getElementById("cubeSwatch").style.background = ac.hex;
    document.getElementById("cubeTitle").textContent = `${ac.id} • ${ac.colorTr}`;
    document.getElementById("cubeZoneBadge").textContent = ac.targetZone;
    document.getElementById("cubeMaterial").textContent = ac.material;
    document.getElementById("cubeConfBadge").textContent = `${ac.confidencePct}% GÜVEN`;
    document.getElementById("cubeDims").textContent = `${ac.sizeMm[0]}×${ac.sizeMm[1]}×${ac.sizeMm[2]} mm`;
    document.getElementById("cubeMass").textContent = `${ac.volumeCm3} cm³ • ${ac.estWeightG} g`;
    document.getElementById("cubePos").textContent =
      `${(ac.worldPosM[0] * 100).toFixed(1)}, ${(ac.worldPosM[1] * 100).toFixed(1)}, ${(ac.worldPosM[2] * 100).toFixed(1)} cm`;
    document.getElementById("cubeYaw").textContent = `${ac.yawDeg.toFixed(1)}°`;
    document.getElementById("cubeRgb").textContent = `(${ac.rgb.join(", ")})`;
    document.getElementById("cubeHsv").textContent = `(${ac.hsv.join(", ")})`;
  }

  document.getElementById("cubeList").innerHTML = mission.cubes
    .map(
      (c) => `
      <div class="cube-row ${c.status === "LOCKED" || c.status === "IN_GRIPPER" ? "active" : ""}">
        <div class="cube-row-left"><span class="mini-dot" style="background:${c.hex};"></span><span>${c.id} (${c.colorTr})</span></div>
        <span style="color:#94a3b8;">${c.status} → ${c.targetZone}</span>
      </div>`
    )
    .join("");

  // Wi-Fi CSI HUD
  const op = csi.operator;
  document.getElementById("csiPresenceBadge").textContent = `${Math.round(op.presenceConfidence * 100)}% VARLIK`;
  document.getElementById("csiOpPos").textContent = `${op.x.toFixed(2)}, ${op.z.toFixed(2)} m`;
  document.getElementById("csiPosture").textContent = `${op.posture} (${Math.round(op.motionEnergy * 100)}%)`;
  document.getElementById("csiBreath").textContent = `${op.breathingBpm.toFixed(1)} BPM`;
  document.getElementById("csiHeart").textContent = `${op.heartRateBpm} BPM`;
  drawCSISpectrum(csi.subcarriersAmp);
  drawRoomPad();

  document.getElementById("csiNodeList").innerHTML = csi.nodes
    .filter((n) => n.role !== "TX_ROUTER")
    .map(
      (n) => `
      <div class="node-row">
        <span>${n.id}</span>
        <span style="color:#94a3b8;">${n.rssiDbm} dBm</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(n.fresnelDisturbance * 100)}%"></div></div>
      </div>`
    )
    .join("");

  // Robot & Electrical HUD
  document.getElementById("armModeBadge").textContent = mission.mode === "auto_pick_place" ? "OTONOM" : "MANUEL";
  if (!draggingSlider) {
    for (const jm of JOINT_META) {
      const v = Math.round(mission.joints[jm.key]);
      jointSliders[jm.key].value = v;
      jointVals[jm.key].textContent = `${v}°`;
    }
  }
  document.getElementById("elecVolt").textContent = `${electrical.busVoltageV.toFixed(2)} V • ${electrical.ubecTempC}°C`;
  document.getElementById("elecAmp").textContent = `${electrical.totalCurrentA.toFixed(2)} A • ${electrical.powerW.toFixed(1)} W`;
  document.getElementById("elecTauSh").textContent = `${electrical.shoulderTorqueNm.toFixed(2)} N·m (${electrical.shoulderTorqueKgCm} kg·cm)`;
  document.getElementById("elecJawGap").textContent = `${electrical.jawGapMm.toFixed(1)} mm`;

  document.getElementById("servoCurrentBars").innerHTML = Object.entries(electrical.pwmChannels)
    .map(
      ([, ch]) => `
      <div class="node-row" style="grid-template-columns: 32px 104px 1fr;">
        <span>CH${ch.ch}</span>
        <span style="color:#94a3b8;">${ch.pwmUs}µs • ${Math.round(ch.currentMa)}mA</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round(ch.currentMa / 14))}%"></div></div>
      </div>`
    )
    .join("");

  document.getElementById("espSerialStats").textContent = esp32.connected
    ? `Durum: USB CANLI (TX: ${esp32.packetsSent} | RX: ${esp32.packetsRx})`
    : `Durum: Simülasyon Modu (WebSerial ${esp32.supported ? "Hazır" : "Chrome/Edge gerekli"})`;
}

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
  lastFrameMs = nowMs;
  elapsed += dt;

  // 1. Step 6-DOF Kinematics, Autonomous Mission & Electrical Physics
  const hwVbus = esp32.hwTelemetry?.vbus ?? null;
  const { fk, electrical } = mission.step(dt, hwVbus);

  // 2. Stream directly to physical ESP32 over USB Web Serial (if connected)
  if (esp32.connected) esp32.sendJoints(mission.joints, nowMs);

  // 3. Step IEEE 802.11n Wi-Fi CSI Room & Operator Physics
  csi.update(dt);

  // 4. Sync Photorealistic 3D Scene
  lab.syncState(mission.joints, fk, electrical, mission.cubes, csi, elapsed, nowMs);

  // 5. Run Real In-Browser Computer Vision (~14 FPS) from Live 3D OV2640 Lens or Real Webcam!
  if (nowMs - lastVisionMs >= 70) {
    lastVisionMs = nowMs;
    const vImg = vision.sourceMode === "virtual3d" ? lab.captureVirtualOV2640ImageData() : null;
    vision.processFrame(vImg, mission.cubes, mission.activeCube?.id ?? null);
  }

  // 6. Refresh HUD at ~15 Hz (zero layout thrash, silky 60 FPS WebGL!)
  if (nowMs - lastUiMs >= 66) {
    lastUiMs = nowMs;
    updateHUD(fk, electrical);
  }

  // 7. Render Cinema PBR + GTAO + Floor Reflection Frame
  lab.renderFrame();
}

requestAnimationFrame(tick);
