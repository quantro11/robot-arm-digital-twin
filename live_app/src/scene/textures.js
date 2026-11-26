import * as THREE from "three";

/**
 * Generates a high-dynamic-range-style studio lighting dome for PMREM reflections.
 * Creates realistic rectangular softbox highlights on brushed aluminum, anodized servos,
 * glass OV2640 lens, and glossy beveled PLA cubes.
 */
export function createStudioEnvironment(renderer, mode = "studio") {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const isDay = mode === "studio";
  envScene.background = new THREE.Color(isDay ? 0xcbd5e1 : 0x0b1220);

  // Overhead warm-white main photography softbox panel
  const mainBox = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 3.2),
    new THREE.MeshBasicMaterial({
      color: isDay ? new THREE.Color(2.4, 2.35, 2.25) : new THREE.Color(1.4, 1.5, 1.7),
      side: THREE.DoubleSide,
    })
  );
  mainBox.position.set(0, 6.2, 0.8);
  mainBox.rotation.x = Math.PI / 2;
  envScene.add(mainBox);

  // Side architectural daylight window reflection panel
  const sideWin = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 4.0),
    new THREE.MeshBasicMaterial({
      color: isDay ? new THREE.Color(2.2, 2.35, 2.55) : new THREE.Color(0.35, 0.85, 1.25),
      side: THREE.DoubleSide,
    })
  );
  sideWin.position.set(6.5, 2.8, 1.2);
  sideWin.rotation.y = -Math.PI / 2;
  envScene.add(sideWin);

  // Warm rim strip on opposite side for metallic edge definition
  const rimStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 2.2),
    new THREE.MeshBasicMaterial({
      color: isDay ? new THREE.Color(1.8, 1.65, 1.45) : new THREE.Color(1.2, 0.72, 0.35),
      side: THREE.DoubleSide,
    })
  );
  rimStrip.position.set(-6.5, 2.4, -2.5);
  rimStrip.rotation.y = Math.PI / 2.2;
  envScene.add(rimStrip);

  // Dark studio floor bounce card for natural contrast on underside of metal joints
  const floorBounce = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({ color: isDay ? 0x334155 : 0x090d14, side: THREE.DoubleSide })
  );
  floorBounce.position.set(0, -3.5, 0);
  floorBounce.rotation.x = -Math.PI / 2;
  envScene.add(floorBounce);

  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  return rt.texture;
}

export function makeCarbonPLAMap() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#222730";
  ctx.fillRect(0, 0, 512, 512);
  // Subtle FDM 0.2mm horizontal print ridges + satin carbon fiber fleck
  for (let y = 0; y < 512; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? "rgba(255,255,255,0.048)" : "rgba(0,0,0,0.10)";
    ctx.fillRect(0, y, 512, 1.5);
  }
  for (let i = 0; i < 3600; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.045)";
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 6);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeBrushedAluminumMap() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#d2dae4";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.12)" : "rgba(40,52,68,0.09)";
    ctx.fillRect(0, y, 512, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function make2020VSlotMap() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ccd5e0";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#485263";
  ctx.fillRect(92, 0, 72, 256);
  ctx.fillStyle = "#222933";
  ctx.fillRect(108, 0, 40, 256);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(88, 0, 4, 256);
  ctx.fillRect(164, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeOakButcherBlockMap() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const ctx = c.getContext("2d");
  const plankH = 64;
  for (let p = 0; p < 8; p++) {
    const baseR = 166 + ((p * 17) % 24) - 12;
    const baseG = 124 + ((p * 13) % 18) - 9;
    const baseB = 82 + ((p * 11) % 14) - 7;
    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, p * plankH, 1024, plankH);

    // Organic oak wood grain fibers
    for (let y = 0; y < plankH; y += 2) {
      const wave = Math.sin((p * 19 + y) * 0.22) * 8 + (Math.random() - 0.5) * 6;
      ctx.fillStyle = `rgba(${Math.max(0, baseR - 28 + wave)},${Math.max(0, baseG - 22 + wave * 0.7)},${Math.max(0, baseB - 16 + wave * 0.5)},0.34)`;
      ctx.fillRect(0, p * plankH + y, 1024, 1.5);
    }
    ctx.fillStyle = "rgba(52, 34, 18, 0.28)";
    ctx.fillRect(0, p * plankH, 1024, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeESDMatMap() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 768;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a222d";
  ctx.fillRect(0, 0, 1024, 768);

  // Matte anti-static silicone micro-texture
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.032)";
    ctx.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }

  ctx.strokeStyle = "rgba(130, 178, 210, 0.34)";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 984, 728);

  ctx.strokeStyle = "rgba(115, 160, 192, 0.13)";
  ctx.lineWidth = 1;
  for (let x = 20; x <= 1004; x += 26) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 748); ctx.stroke(); }
  for (let y = 20; y <= 748; y += 26) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(1004, y); ctx.stroke(); }

  ctx.strokeStyle = "rgba(125, 190, 228, 0.24)";
  ctx.lineWidth = 1.4;
  for (let x = 20; x <= 1004; x += 130) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 748); ctx.stroke(); }
  for (let y = 20; y <= 748; y += 130) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(1004, y); ctx.stroke(); }

  // Calibrated Pickup Bay silkscreen
  ctx.strokeStyle = "rgba(160, 220, 245, 0.55)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(365, 420, 294, 210);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(182, 228, 248, 0.70)";
  ctx.font = "600 17px Consolas, monospace";
  ctx.fillText("VISION CALIBRATED PICKUP BAY", 386, 444);

  // Corner fiducial marks
  ctx.strokeStyle = "rgba(220, 236, 248, 0.58)";
  ctx.lineWidth = 2;
  for (const [fx, fy] of [[52, 52], [972, 52], [52, 716], [972, 716]]) {
    ctx.strokeRect(fx - 12, fy - 12, 24, 24);
    ctx.beginPath();
    ctx.moveTo(fx - 18, fy); ctx.lineTo(fx + 18, fy);
    ctx.moveTo(fx, fy - 18); ctx.lineTo(fx, fy + 18);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(155, 184, 208, 0.60)";
  ctx.font = "600 14px Consolas, monospace";
  ctx.fillText("ESD ANTI-STATIC MAT • 760 × 560 mm • 10^6–10^9 Ω/sq", 36, 738);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeConcreteFloorMap(mode = "studio") {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  const isDay = mode === "studio";
  ctx.fillStyle = isDay ? "#aeb7c2" : "#1a2029";
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const base = isDay ? 155 : 22;
    const v = base + Math.floor(Math.random() * 28);
    ctx.fillStyle = `rgba(${v},${v + 3},${v + 7},0.28)`;
    ctx.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  ctx.strokeStyle = isDay ? "rgba(75, 86, 102, 0.25)" : "rgba(6, 10, 16, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeLabWhiteboardMap() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f7fb";
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, 1000, 488);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 28px Segoe UI, sans-serif";
  ctx.fillText("ELEKTRİK MÜHENDİSLİĞİ • 6-DOF ROBOT KOL & WI-FI CSI LAB", 42, 62);
  ctx.fillStyle = "#475569";
  ctx.font = "600 18px Consolas, monospace";
  ctx.fillText("IK: L0=95mm  L1=175mm  L2=165mm  L3=95mm  |  6.0V 8A UBEC + PCA9685", 42, 96);
  ctx.fillText("RF: IEEE 802.11n HT20 CH6 (2437 MHz, λ=12.3cm) • 52 Subcarriers • RuView CSI", 42, 124);

  // Kinematic stick diagram (blue whiteboard marker style)
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(140, 415); ctx.lineTo(140, 320); ctx.lineTo(255, 200);
  ctx.lineTo(395, 260); ctx.lineTo(395, 355);
  ctx.stroke();
  for (const [jx, jy, lbl] of [[140,320,"J2 (DS3218)"],[255,200,"J3"],[395,260,"J4"],[395,355,"TCP"]]) {
    ctx.fillStyle = "#dc2626";
    ctx.beginPath(); ctx.arc(jx, jy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1e293b";
    ctx.fillText(lbl, jx + 12, jy - 6);
  }

  // Fresnel ellipse schematic (teal & amber marker style)
  ctx.strokeStyle = "#0d9488";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(740, 305, 195, 62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#d97706";
  ctx.beginPath(); ctx.arc(545, 305, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0284c7";
  ctx.beginPath(); ctx.arc(935, 305, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillText("TX AP (2.4GHz)", 505, 344);
  ctx.fillText("RX ESP32-S3", 868, 344);
  ctx.fillText("1st Fresnel Zone: r1 = sqrt(λ·d1·d2 / (d1+d2))", 536, 414);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
