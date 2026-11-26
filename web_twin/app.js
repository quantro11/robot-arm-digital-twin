import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

RectAreaLightUniformsLib.init();

// ---------------------------------------------------------------------------
// 1. High-Resolution Procedural PBR Textures (Albedo, Bump, Roughness)
// ---------------------------------------------------------------------------
function makeCarbonPLAMaps() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#20252f";
  ctx.fillRect(0, 0, 512, 512);
  // Subtle FDM 0.2mm horizontal print layer lines + micro carbon-fiber speckle
  for (let y = 0; y < 512; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.11)";
    ctx.fillRect(0, y, 512, 1.5);
  }
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(x, y, 2, 1);
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 6);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function makeBrushedAluminumMap() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c9d2de";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) {
    const y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.11)" : "rgba(35,45,60,0.09)";
    ctx.fillRect(0, y, 512, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function make2020ExtrusionMap() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c3ccd8";
  ctx.fillRect(0, 0, 256, 256);
  // Central V-slot channel dark recess
  ctx.fillStyle = "#3c4554";
  ctx.fillRect(92, 0, 72, 256);
  ctx.fillStyle = "#1f2630";
  ctx.fillRect(108, 0, 40, 256);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(88, 0, 4, 256);
  ctx.fillRect(164, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeESDMatTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 768;
  const ctx = c.getContext("2d");

  // Real matte anti-static silicone-rubber ESD blue-charcoal base
  ctx.fillStyle = "#18202a";
  ctx.fillRect(0, 0, 1024, 768);
  // Subtle micro-speckle rubber grain
  for (let i = 0; i < 8000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.035)";
    ctx.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }

  // Outer technical border frame
  ctx.strokeStyle = "rgba(120, 165, 198, 0.32)";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 984, 728);

  // Calibrated metric grid (minor 2cm, major 10cm)
  ctx.strokeStyle = "rgba(105, 148, 180, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 20; x <= 1004; x += 26) {
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 748); ctx.stroke();
  }
  for (let y = 20; y <= 748; y += 26) {
    ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(1004, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(110, 175, 215, 0.22)";
  ctx.lineWidth = 1.4;
  for (let x = 20; x <= 1004; x += 130) {
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 748); ctx.stroke();
  }
  for (let y = 20; y <= 748; y += 130) {
    ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(1004, y); ctx.stroke();
  }

  // ESD Mat silkscreen pickup bay marking (calibrated around robot forward pickup bay)
  ctx.strokeStyle = "rgba(148, 215, 240, 0.48)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(365, 420, 294, 210);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(170, 220, 240, 0.62)";
  ctx.font = "600 17px Consolas, monospace";
  ctx.fillText("OPENCV CALIBRATED PICKUP BAY", 386, 444);

  // Corner fiducial calibration crosses
  ctx.strokeStyle = "rgba(210, 228, 242, 0.55)";
  ctx.lineWidth = 2;
  for (const [fx, fy] of [[52, 52], [972, 52], [52, 716], [972, 716]]) {
    ctx.strokeRect(fx - 12, fy - 12, 24, 24);
    ctx.beginPath();
    ctx.moveTo(fx - 18, fy); ctx.lineTo(fx + 18, fy);
    ctx.moveTo(fx, fy - 18); ctx.lineTo(fx, fy + 18);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(148, 175, 198, 0.55)";
  ctx.font = "600 14px Consolas, monospace";
  ctx.fillText("ESD SAFE MAT • 760 × 560 mm • 10^6–10^9 Ω/sq", 36, 738);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConcreteFloorMaps() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#181d25";
  ctx.fillRect(0, 0, 512, 512);
  // Subtle polished concrete lab floor aggregate texture
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const v = 22 + Math.floor(Math.random() * 18);
    ctx.fillStyle = `rgba(${v},${v + 4},${v + 10},0.35)`;
    ctx.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // Clean expansion joint seams
  ctx.strokeStyle = "rgba(8, 11, 16, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWoodDeskEdgeTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#4b382a";
  ctx.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y += 2) {
    const shade = Math.sin(y * 0.14) * 10 + (Math.random() - 0.5) * 8;
    ctx.fillStyle = `rgb(${76 + shade},${56 + shade * 0.8},${42 + shade * 0.6})`;
    ctx.fillRect(0, y, 512, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabWhiteboardTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#101722";
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, 996, 484);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 28px Segoe UI, sans-serif";
  ctx.fillText("6-DOF VISION ROBOTIC ARM & WI-FI CSI LAB", 44, 62);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "18px Consolas, monospace";
  ctx.fillText("IK: L0=95mm  L1=175mm  L2=165mm  L3=95mm  |  6.0V 8A UBEC + PCA9685", 44, 98);
  ctx.fillText("RF: IEEE 802.11n HT20 CH6 (2437 MHz, λ=12.3cm) • 52 Subcarriers • RuView CSI", 44, 128);

  // Mini kinematic schematic diagram on wall board
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(140, 410); ctx.lineTo(140, 320); ctx.lineTo(255, 200);
  ctx.lineTo(395, 260); ctx.lineTo(395, 355);
  ctx.stroke();
  for (const [jx, jy, lbl] of [[140,320,"J2"],[255,200,"J3"],[395,260,"J4"],[395,355,"TCP"]]) {
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(jx, jy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(lbl, jx + 12, jy - 6);
  }
  // Mini Fresnel ellipse schematic
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(735, 310, 195, 62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath(); ctx.arc(540, 310, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath(); ctx.arc(930, 310, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText("TX AP", 518, 345);
  ctx.fillText("RX ESP32-S3", 865, 345);
  ctx.fillText("1st Fresnel Zone: r1 = sqrt(λ·d1·d2 / (d1+d2))", 540, 415);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// 2. Renderer, HDRI Reflections, Studio Softbox Lights & Post-Processing
// ---------------------------------------------------------------------------
const container = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
scene.fog = new THREE.FogExp2(0x0b0f16, 0.062);

// Rich PMREM Studio Reflections (makes aluminum, clearcoat PLA & glass pop!)
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.88;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.02, 40);
camera.position.set(0.45, 0.36, 0.50);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0.0, 0.11, 0.16);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.22;
controls.maxDistance = 5.6;

// Studio Post-Processing Pipeline (Subtle Selective Bloom + SMAA + ACES Output)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.22, // Subtle studio bloom only on emissive LEDs & RF crests
  0.38,
  0.94
);
composer.addPass(bloomPass);
composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight));
composer.addPass(new OutputPass());

// Realistic Lighting Rig: Overhead Linear Softbox RectAreaLights + Crisp Key Shadow Light
const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e2430, 0.42);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.25);
keyLight.position.set(1.25, 2.55, 1.15);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.2;
keyLight.shadow.camera.far = 8.0;
const shDim = 1.35;
keyLight.shadow.camera.left = -shDim;
keyLight.shadow.camera.right = shDim;
keyLight.shadow.camera.top = shDim;
keyLight.shadow.camera.bottom = -shDim;
keyLight.shadow.bias = -0.0003;
keyLight.shadow.normalBias = 0.006;
scene.add(keyLight);

// True Rectangular Studio Softboxes (creates realistic specular reflections on metal & cubes!)
const overheadSoftbox = new THREE.RectAreaLight(0xfff8f0, 4.2, 1.1, 0.36);
overheadSoftbox.position.set(0, 1.38, 0.22);
overheadSoftbox.lookAt(0, 0, 0.18);
scene.add(overheadSoftbox);

const rimSoftbox = new THREE.RectAreaLight(0xbae6fd, 2.6, 1.4, 0.28);
rimSoftbox.position.set(-1.35, 1.05, -1.15);
rimSoftbox.lookAt(0, 0.15, 0.15);
scene.add(rimSoftbox);

// ---------------------------------------------------------------------------
// 3. Shared Physically-Based Materials
// ---------------------------------------------------------------------------
const plaMap = makeCarbonPLAMaps();
const aluMap = makeBrushedAluminumMap();
const vslotMap = make2020ExtrusionMap();

const matCarbonPLA = new THREE.MeshPhysicalMaterial({
  color: 0x242a34,
  map: plaMap,
  bumpMap: plaMap,
  bumpScale: 0.0014,
  roughness: 0.42,
  metalness: 0.12,
  clearcoat: 0.22,
  clearcoatRoughness: 0.45,
});

const matOrangePLA = new THREE.MeshPhysicalMaterial({
  color: 0xea580c,
  bumpMap: plaMap,
  bumpScale: 0.0012,
  roughness: 0.34,
  metalness: 0.06,
  clearcoat: 0.38,
  clearcoatRoughness: 0.32,
});

const matAluminum = new THREE.MeshPhysicalMaterial({
  color: 0xd8e0ea,
  map: aluMap,
  roughness: 0.22,
  metalness: 0.92,
  clearcoat: 0.12,
});

const matVSlot = new THREE.MeshPhysicalMaterial({
  color: 0xd2dbe6,
  map: vslotMap,
  roughness: 0.28,
  metalness: 0.88,
});

const matDarkAnodized = new THREE.MeshStandardMaterial({
  color: 0x1b2029,
  roughness: 0.32,
  metalness: 0.78,
});

const matServoBody = new THREE.MeshStandardMaterial({
  color: 0x151922,
  roughness: 0.48,
  metalness: 0.18,
});

// Authentic DS3218 Pro anodized crimson-red / metallic aluminum center heatsink
const matServoAnodized = new THREE.MeshPhysicalMaterial({
  color: 0x991b1b,
  roughness: 0.24,
  metalness: 0.86,
  clearcoat: 0.25,
});

const matBrass = new THREE.MeshStandardMaterial({
  color: 0xd4a64a,
  roughness: 0.26,
  metalness: 0.92,
});

const matBolt = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.2,
  metalness: 0.95,
});

const matSilicone = new THREE.MeshStandardMaterial({
  color: 0x0d1016,
  roughness: 0.92,
  metalness: 0.02,
});

// ---------------------------------------------------------------------------
// 4. Architectural Robotics Lab Room + Realistic ESD Workbench + Electronics
// ---------------------------------------------------------------------------
const TABLE_HEIGHT = 0.78; // Floor sits at Y = -0.78m so workbench top is EXACTLY Y = 0.0m!
const roomGroup = new THREE.Group();
scene.add(roomGroup);

// Polished Concrete Lab Floor
const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(6.4, 6.4),
  new THREE.MeshPhysicalMaterial({
    map: makeConcreteFloorMaps(),
    roughness: 0.32,
    metalness: 0.08,
    clearcoat: 0.28,
    clearcoatRoughness: 0.36,
  })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.position.y = -TABLE_HEIGHT;
floorMesh.receiveShadow = true;
roomGroup.add(floorMesh);

// Architectural Lab Back & Side Walls with Acoustic Slat Detail
const labWallMat = new THREE.MeshStandardMaterial({ color: 0x141923, roughness: 0.85, metalness: 0.05 });
const slatMat = new THREE.MeshStandardMaterial({ color: 0x26211e, roughness: 0.72, metalness: 0.05 });

const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 0.06), labWallMat);
backWall.position.set(0, -TABLE_HEIGHT + 1.3, -2.13);
backWall.receiveShadow = true;
roomGroup.add(backWall);

// Subtle Vertical Acoustic Wood Slats flanking the Lab Whiteboard
for (let sx = -2.0; sx <= 2.0; sx += 0.14) {
  if (Math.abs(sx) < 0.95) continue;
  const slat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.45, 0.03), slatMat);
  slat.position.set(sx, -TABLE_HEIGHT + 1.25, -2.09);
  roomGroup.add(slat);
}

// Framed Technical Lab Whiteboard on Back Wall
const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.92, 0.03), matDarkAnodized);
boardFrame.position.set(0, 0.62, -2.09);
roomGroup.add(boardFrame);
const boardFace = new THREE.Mesh(
  new THREE.PlaneGeometry(1.68, 0.84),
  new THREE.MeshStandardMaterial({ map: makeLabWhiteboardTexture(), roughness: 0.35 })
);
boardFace.position.set(0, 0.62, -2.072);
roomGroup.add(boardFace);

// Subtle Translucent Glass Side Lab Partitions (4.2m room boundary)
const glassWallMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e293b,
  roughness: 0.18,
  metalness: 0.1,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
});
for (const side of [-1, 1]) {
  const gw = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.5), glassWallMat);
  gw.position.set(side * 2.1, -TABLE_HEIGHT + 1.25, 0);
  gw.rotation.y = -side * Math.PI / 2;
  roomGroup.add(gw);
  // Top & bottom aluminum mullion bars
  for (const my of [-TABLE_HEIGHT + 0.04, -TABLE_HEIGHT + 2.48]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 4.2), matDarkAnodized);
    mullion.position.set(side * 2.1, my, 0);
    roomGroup.add(mullion);
  }
}

// Hanging Overhead Linear LED Light Fixture (matches RectAreaLight position!)
const fixtureHousing = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.045, 0.22), matDarkAnodized);
fixtureHousing.position.set(0, 1.41, 0.22);
roomGroup.add(fixtureHousing);
const fixtureDiffuser = new THREE.Mesh(
  new THREE.PlaneGeometry(1.08, 0.18),
  new THREE.MeshBasicMaterial({ color: 0xfffaf0 })
);
fixtureDiffuser.rotation.x = Math.PI / 2;
fixtureDiffuser.position.set(0, 1.386, 0.22);
roomGroup.add(fixtureDiffuser);

// --- INDUSTRIAL ESD ROBOTICS WORKBENCH (Top flush at Y = 0.000) ---
const deskGroup = new THREE.Group();
scene.add(deskGroup);

const deskTop = new THREE.Mesh(
  new RoundedBoxGeometry(1.04, 0.042, 0.76, 4, 0.005),
  new THREE.MeshStandardMaterial({ map: makeWoodDeskEdgeTexture(), roughness: 0.56, metalness: 0.05 })
);
deskTop.position.set(0, -0.021, 0.15);
deskTop.receiveShadow = true;
deskTop.castShadow = true;
deskGroup.add(deskTop);

// Brushed Aluminum Front Edge Trim
const deskTrim = new THREE.Mesh(new THREE.BoxGeometry(1.044, 0.012, 0.008), matAluminum);
deskTrim.position.set(0, -0.018, 0.532);
deskGroup.add(deskTrim);

// Anti-Static ESD Mat sitting flush on desk top (Y = 0.0008)
const esdMat = new THREE.Mesh(
  new THREE.BoxGeometry(0.76, 0.002, 0.56),
  new THREE.MeshStandardMaterial({
    map: makeESDMatTexture(),
    roughness: 0.76,
    metalness: 0.04,
  })
);
esdMat.position.set(0, 0.0005, 0.18);
esdMat.receiveShadow = true;
deskGroup.add(esdMat);

// Heavy Steel Frame Legs + Lower Crossbeams + Rubber Feet
const legGeo = new THREE.BoxGeometry(0.044, TABLE_HEIGHT - 0.042, 0.044);
for (const [lx, lz] of [[-0.46, -0.18], [0.46, -0.18], [-0.46, 0.48], [0.46, 0.48]]) {
  const leg = new THREE.Mesh(legGeo, matDarkAnodized);
  leg.position.set(lx, -TABLE_HEIGHT / 2 - 0.021, lz);
  leg.castShadow = true;
  leg.receiveShadow = true;
  deskGroup.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.014, 16), matSilicone);
  foot.position.set(lx, -TABLE_HEIGHT + 0.007, lz);
  deskGroup.add(foot);
}
const backBrace = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.03, 0.03), matDarkAnodized);
backBrace.position.set(0, -TABLE_HEIGHT + 0.18, -0.18);
deskGroup.add(backBrace);

// --- REAL BENCHTOP ELECTRONICS (100% Consistent with BOM & Wiring Diagram!) ---

// 1) Digital Lab DC Power Supply (6.0V UBEC) with LIVE 7-Segment Canvas Display!
const psuCanvas = document.createElement("canvas");
psuCanvas.width = 256; psuCanvas.height = 128;
const psuCtx = psuCanvas.getContext("2d");
const psuTex = new THREE.CanvasTexture(psuCanvas);
psuTex.colorSpace = THREE.SRGBColorSpace;

function updatePSUScreen(v, a, w) {
  psuCtx.fillStyle = "#080c12";
  psuCtx.fillRect(0, 0, 256, 128);
  psuCtx.strokeStyle = "#1e293b";
  psuCtx.lineWidth = 4;
  psuCtx.strokeRect(4, 4, 248, 120);
  psuCtx.fillStyle = "#22d3ee";
  psuCtx.font = "bold 40px Consolas, monospace";
  psuCtx.fillText(`${v.toFixed(2)}V`, 18, 52);
  psuCtx.fillStyle = "#f59e0b";
  psuCtx.font = "bold 36px Consolas, monospace";
  psuCtx.fillText(`${a.toFixed(2)}A`, 18, 98);
  psuCtx.fillStyle = "#4ade80";
  psuCtx.font = "bold 18px Consolas, monospace";
  psuCtx.fillText("CV", 198, 34);
  psuCtx.fillStyle = "#94a3b8";
  psuCtx.font = "18px Consolas, monospace";
  psuCtx.fillText(`${w.toFixed(1)}W`, 178, 98);
  psuTex.needsUpdate = true;
}
updatePSUScreen(6.0, 0.82, 4.9);

const psuGroup = new THREE.Group();
psuGroup.position.set(-0.37, 0.052, -0.09);
psuGroup.rotation.y = 0.28;
deskGroup.add(psuGroup);

const psuBody = new THREE.Mesh(new RoundedBoxGeometry(0.145, 0.104, 0.155, 3, 0.006), matDarkAnodized);
psuBody.castShadow = true;
psuBody.receiveShadow = true;
psuGroup.add(psuBody);
const psuScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(0.112, 0.056),
  new THREE.MeshBasicMaterial({ map: psuTex })
);
psuScreen.position.set(0, 0.014, 0.0785);
psuGroup.add(psuScreen);
// Red (+6V) & Black (GND) Banana Terminal Posts on PSU front
for (const [bx, col] of [[-0.032, 0xdc2626], [0.002, 0x111827]]) {
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.014, 14),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })
  );
  post.rotation.x = Math.PI / 2;
  post.position.set(bx, -0.032, 0.082);
  psuGroup.add(post);
}

// 2) Detailed ESP32 DevKit V1 + PCA9685 + 1000uF Capacitor on Acrylic Electronics Tray
const elecTray = new THREE.Group();
elecTray.position.set(-0.22, 0.004, -0.06);
deskGroup.add(elecTray);

const trayPlate = new THREE.Mesh(
  new RoundedBoxGeometry(0.15, 0.005, 0.095, 2, 0.002),
  new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.25, clearcoat: 0.7 })
);
trayPlate.castShadow = true;
elecTray.add(trayPlate);

// ESP32 DevKit PCB (Black PCB + Silver RF Shield Can + Gold Pins + Blinking Blue TX LED)
const espPcb = new THREE.Mesh(
  new THREE.BoxGeometry(0.054, 0.003, 0.028),
  new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.5 })
);
espPcb.position.set(-0.036, 0.005, -0.018);
elecTray.add(espPcb);
const espCan = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.004, 0.016), matAluminum);
espCan.position.set(-0.048, 0.008, -0.018);
elecTray.add(espCan);
const espLedMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.2 });
const espLed = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.002), espLedMat);
espLed.position.set(-0.016, 0.008, -0.015);
elecTray.add(espLed);

// PCA9685 16-Channel PWM Driver (Classic Blue PCB + Green Screw Terminal + 1000uF Electrolytic Cap!)
const pcaPcb = new THREE.Mesh(
  new THREE.BoxGeometry(0.062, 0.003, 0.026),
  new THREE.MeshStandardMaterial({ color: 0x0b4f8c, roughness: 0.42 })
);
pcaPcb.position.set(0.034, 0.005, -0.012);
elecTray.add(pcaPcb);
const screwTerm = new THREE.Mesh(
  new THREE.BoxGeometry(0.011, 0.010, 0.012),
  new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.5 })
);
screwTerm.position.set(0.006, 0.010, -0.012);
elecTray.add(screwTerm);
// 1000uF 16V Electrolytic Filter Capacitor (Blue Cylinder + Brushed Aluminum Top)
const capBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0055, 0.0055, 0.016, 18),
  new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3, metalness: 0.3 })
);
capBody.position.set(0.020, 0.014, -0.012);
elecTray.add(capBody);
const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0053, 0.0053, 0.001, 18), matAluminum);
capTop.position.set(0.020, 0.0225, -0.012);
elecTray.add(capTop);

// Braided 6-servo wiring bundle connecting PCA9685 into the Robot Base
const baseWireCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.155, 0.012, -0.062),
  new THREE.Vector3(-0.115, 0.016, -0.048),
  new THREE.Vector3(-0.072, 0.014, -0.012),
]);
const baseWire = new THREE.Mesh(
  new THREE.TubeGeometry(baseWireCurve, 20, 0.0045, 8, false),
  new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.78 })
);
baseWire.castShadow = true;
deskGroup.add(baseWire);

// 3) Industrial Red Mushroom E-Stop Button (Front-Left Corner)
const estopGroup = new THREE.Group();
estopGroup.position.set(-0.42, 0.022, 0.36);
deskGroup.add(estopGroup);
const estopBox = new THREE.Mesh(
  new RoundedBoxGeometry(0.066, 0.044, 0.066, 3, 0.005),
  new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.42 })
);
estopBox.castShadow = true;
estopGroup.add(estopBox);
const estopStem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.014, 16), matDarkAnodized);
estopStem.position.y = 0.026;
estopGroup.add(estopStem);
const estopCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.019, 0.016, 24),
  new THREE.MeshPhysicalMaterial({ color: 0xdc2626, roughness: 0.25, clearcoat: 0.6 })
);
estopCap.position.y = 0.036;
estopCap.castShadow = true;
estopGroup.add(estopCap);

// --- 2020 V-SLOT EXTRUDED ALUMINUM OVERHEAD CAMERA GANTRY + AI-THINKER ESP32-CAM ---
const gantryGroup = new THREE.Group();
deskGroup.add(gantryGroup);

const postGeo = new THREE.BoxGeometry(0.022, 0.54, 0.022);
for (const gx of [-0.36, 0.36]) {
  const post = new THREE.Mesh(postGeo, matVSlot);
  post.position.set(gx, 0.27, 0.22);
  post.castShadow = true;
  gantryGroup.add(post);

  // Base flange + top 90-degree aluminum corner L-bracket
  const flange = new THREE.Mesh(new RoundedBoxGeometry(0.054, 0.008, 0.054, 2, 0.002), matDarkAnodized);
  flange.position.set(gx, 0.004, 0.22);
  gantryGroup.add(flange);

  const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.024), matAluminum);
  gusset.position.set(gx - Math.sign(gx) * 0.022, 0.522, 0.22);
  gantryGroup.add(gusset);
}
const crossBar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.022, 0.022), matVSlot);
crossBar.position.set(0, 0.545, 0.22);
crossBar.castShadow = true;
gantryGroup.add(crossBar);

// Detailed AI-Thinker ESP32-CAM Module at EXACT (0, 0.52, 0.22) matching OpenCV Pinhole Geometry!
const camMount = new THREE.Group();
camMount.position.set(0, 0.524, 0.22);
gantryGroup.add(camMount);

const camCase = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.018, 0.034, 2, 0.003), matCarbonPLA);
camCase.castShadow = true;
camMount.add(camCase);
const camLensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0085, 0.011, 24), matDarkAnodized);
camLensBarrel.position.y = -0.011;
camMount.add(camLensBarrel);
const camGlass = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 20),
  new THREE.MeshPhysicalMaterial({ color: 0x0a192f, roughness: 0.05, metalness: 0.2, clearcoat: 1.0 })
);
camGlass.position.y = -0.0165;
camMount.add(camGlass);
// Subtle Diffused Warm-White Ring LED Illuminator around OV2640 Lens
const camRingLed = new THREE.Mesh(
  new THREE.TorusGeometry(0.014, 0.0022, 10, 28),
  new THREE.MeshBasicMaterial({ color: 0xfff5e4 })
);
camRingLed.rotation.x = Math.PI / 2;
camRingLed.position.y = -0.0095;
camMount.add(camRingLed);

// Translucent Camera Vision Frustum Cone (hidden automatically during virtual OV2640 lens capture!)
const camConeGeo = new THREE.ConeGeometry(0.31, 0.51, 4, 1, true);
camConeGeo.rotateY(Math.PI / 4);
const camCone = new THREE.Mesh(
  camConeGeo,
  new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.045,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
camCone.position.set(0, 0.26, 0.22);
gantryGroup.add(camCone);

// Sorting Zone Sleek Anodized Tray Frames
const zonePadGroup = new THREE.Group();
deskGroup.add(zonePadGroup);
let zonesBuilt = false;

function buildZonePads(zones) {
  if (zonesBuilt || !zones) return;
  zonesBuilt = true;
  for (const z of zones) {
    const col = new THREE.Color(z.hex);
    const pad = new THREE.Mesh(
      new RoundedBoxGeometry(0.074, 0.003, 0.074, 2, 0.001),
      new THREE.MeshPhysicalMaterial({
        color: 0x131922,
        roughness: 0.48,
        metalness: 0.25,
        emissive: col,
        emissiveIntensity: 0.14,
      })
    );
    pad.position.set(z.pos[0], 0.0022, z.pos[2]);
    pad.receiveShadow = true;
    zonePadGroup.add(pad);

    // Subtle colored anodized rim strip around each drop tray
    const rim = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.075, 0.0035, 0.075)),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 })
    );
    rim.position.copy(pad.position);
    zonePadGroup.add(rim);
  }
}

// ---------------------------------------------------------------------------
// 5. Hyper-Detailed 6-DOF 3D-Printed Robotic Arm (Exact L0, L1, L2, L3!)
//    DS3218 Pro Servos + Beveled Carbon-PLA + Meshed Spur-Gear Gripper + Flexing Cable Loom
// ---------------------------------------------------------------------------
const L0 = 0.095, L1 = 0.175, L2 = 0.165, L3 = 0.095;

function createDS3218Servo(scale = 1.0) {
  const g = new THREE.Group();
  // Bottom polyamide housing
  const bot = new THREE.Mesh(new RoundedBoxGeometry(0.040 * scale, 0.011 * scale, 0.020 * scale, 2, 0.0015), matServoBody);
  bot.position.y = -0.014 * scale;
  g.add(bot);
  // Anodized crimson-aluminum center heatsink body
  const mid = new THREE.Mesh(new RoundedBoxGeometry(0.0405 * scale, 0.018 * scale, 0.0205 * scale, 2, 0.0015), matServoAnodized);
  mid.castShadow = true;
  g.add(mid);
  // Top gearcase + mounting ears
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.040 * scale, 0.010 * scale, 0.020 * scale, 2, 0.0015), matServoBody);
  top.position.y = 0.013 * scale;
  g.add(top);
  const ears = new THREE.Mesh(new THREE.BoxGeometry(0.054 * scale, 0.0025 * scale, 0.020 * scale), matServoBody);
  ears.position.y = 0.009 * scale;
  g.add(ears);
  // Brass 25T spline shaft
  const spline = new THREE.Mesh(new THREE.CylinderGeometry(0.003 * scale, 0.003 * scale, 0.007 * scale, 14), matBrass);
  spline.position.set(0.010 * scale, 0.021 * scale, 0);
  g.add(spline);
  return g;
}

function createServoHornDisc(radius = 0.016) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.0045, 28), matAluminum);
  disc.castShadow = true;
  g.add(disc);
  const centerBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.006, 6), matBolt);
  g.add(centerBolt);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0055, 8), matBolt);
    sc.position.set(Math.cos(a) * radius * 0.65, 0, Math.sin(a) * radius * 0.65);
    g.add(sc);
  }
  return g;
}

const robotRoot = new THREE.Group();
scene.add(robotRoot);

// Heavy CNC Bolted Base Pedestal
const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 0.013, 44), matDarkAnodized);
basePlate.position.y = 0.007;
basePlate.castShadow = true;
basePlate.receiveShadow = true;
robotRoot.add(basePlate);

// 8x M4 Stainless Hex Socket Base Bolts
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI * 2) / 8;
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.005, 6), matBolt);
  bolt.position.set(Math.cos(a) * 0.065, 0.015, Math.sin(a) * 0.065);
  robotRoot.add(bolt);
}

// Recessed Cyan Telemetry Ring
const baseRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.058, 0.0018, 12, 56),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.5 })
);
baseRing.rotation.x = Math.PI / 2;
baseRing.position.y = 0.015;
robotRoot.add(baseRing);

const baseHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.056, 0.036, 36), matCarbonPLA);
baseHousing.position.y = 0.032;
baseHousing.castShadow = true;
robotRoot.add(baseHousing);

// J1: Turntable Yaw Pivot
const j1Group = new THREE.Group();
j1Group.position.set(0, 0.050, 0);
robotRoot.add(j1Group);

const bearingRace = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.049, 0.009, 36), matAluminum);
bearingRace.position.y = 0.0045;
bearingRace.castShadow = true;
j1Group.add(bearingRace);

// Sculpted Beveled Shoulder Clevis U-Bracket (rises to shoulder pivot at L0 = 0.095m)
const turretBase = new THREE.Mesh(new RoundedBoxGeometry(0.072, 0.014, 0.058, 3, 0.003), matCarbonPLA);
turretBase.position.y = 0.014;
turretBase.castShadow = true;
j1Group.add(turretBase);

for (const side of [-1, 1]) {
  const cheek = new THREE.Mesh(new RoundedBoxGeometry(0.011, 0.050, 0.044, 3, 0.003), matCarbonPLA);
  cheek.position.set(side * 0.031, 0.036, 0);
  cheek.castShadow = true;
  j1Group.add(cheek);
}
const shServo = createDS3218Servo(1.0);
shServo.rotation.z = Math.PI / 2;
shServo.position.set(0.006, 0.045, -0.010);
j1Group.add(shServo);

// J2: Shoulder Pitch Pivot (EXACT World Y = L0 = 0.095m)
const j2Group = new THREE.Group();
j2Group.position.set(0, L0 - 0.050, 0);
j1Group.add(j2Group);

const shShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.078, 24), matDarkAnodized);
shShaft.rotation.z = Math.PI / 2;
j2Group.add(shShaft);
for (const side of [-1, 1]) {
  const horn = createServoHornDisc(0.017);
  horn.rotation.z = side * Math.PI / 2;
  horn.position.x = side * 0.039;
  j2Group.add(horn);
}

// Sculpted Dual-Side Beveled 3D-Printed Carbon-PLA Upper Arm (Length L1 = 0.175m)
for (const side of [-1, 1]) {
  const beam = new THREE.Mesh(new RoundedBoxGeometry(0.010, L1 + 0.018, 0.034, 3, 0.003), matCarbonPLA);
  beam.position.set(side * 0.023, L1 * 0.5, 0);
  beam.castShadow = true;
  beam.receiveShadow = true;
  j2Group.add(beam);

  // Subtle Industrial Prusa-Orange 3D-Printed Accent Rib
  const rib = new THREE.Mesh(new RoundedBoxGeometry(0.0115, L1 * 0.54, 0.009, 2, 0.002), matOrangePLA);
  rib.position.set(side * 0.023, L1 * 0.5, 0);
  j2Group.add(rib);
}
// Structural aluminum standoff spacers between upper arm beams
for (const frac of [0.26, 0.52, 0.78]) {
  const spacer = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.044, 14), matAluminum);
  spacer.rotation.z = Math.PI / 2;
  spacer.position.set(0, L1 * frac, 0);
  j2Group.add(spacer);
}

// J3: Elbow Pitch Pivot (at local Y = L1 = 0.175m)
const j3Group = new THREE.Group();
j3Group.position.set(0, L1, 0);
j2Group.add(j3Group);

const elServo = createDS3218Servo(0.92);
elServo.rotation.z = Math.PI / 2;
elServo.position.set(0.004, 0.002, -0.009);
j3Group.add(elServo);
for (const side of [-1, 1]) {
  const horn = createServoHornDisc(0.015);
  horn.rotation.z = side * Math.PI / 2;
  horn.position.x = side * 0.032;
  j3Group.add(horn);
}

// Sculpted Beveled 3D-Printed Forearm (Length L2 = 0.165m)
const forearm = new THREE.Mesh(new RoundedBoxGeometry(0.030, L2 - 0.006, 0.028, 3, 0.004), matCarbonPLA);
forearm.position.set(0, L2 * 0.5, 0);
forearm.castShadow = true;
forearm.receiveShadow = true;
j3Group.add(forearm);

const forearmTrim = new THREE.Mesh(new RoundedBoxGeometry(0.032, L2 * 0.48, 0.008, 2, 0.002), matOrangePLA);
forearmTrim.position.set(0, L2 * 0.52, 0);
j3Group.add(forearmTrim);

// J4: Wrist Pitch Pivot (at local Y = L2 = 0.165m)
const j4Group = new THREE.Group();
j4Group.position.set(0, L2, 0);
j3Group.add(j4Group);

const wrServo = createDS3218Servo(0.72);
wrServo.rotation.z = Math.PI / 2;
wrServo.position.set(0, 0.004, -0.004);
j4Group.add(wrServo);
for (const side of [-1, 1]) {
  const horn = createServoHornDisc(0.011);
  horn.rotation.z = side * Math.PI / 2;
  horn.position.x = side * 0.022;
  j4Group.add(horn);
}

const wrCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.030, 24), matCarbonPLA);
wrCollar.position.y = 0.018;
wrCollar.castShadow = true;
j4Group.add(wrCollar);

// J5: Wrist Roll Pivot
const j5Group = new THREE.Group();
j5Group.position.set(0, 0.034, 0);
j4Group.add(j5Group);

const rollFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 24), matAluminum);
rollFlange.position.y = 0.003;
j5Group.add(rollFlange);

// Parallel Spur-Gear Gripper Chassis
const gripperBody = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.022, 0.024, 3, 0.003), matCarbonPLA);
gripperBody.position.y = 0.016;
gripperBody.castShadow = true;
j5Group.add(gripperBody);

// Visible MG90S Gripper Micro-Servo on back of gripper chassis
const gripMicroServo = new THREE.Mesh(new RoundedBoxGeometry(0.023, 0.022, 0.013, 2, 0.0015), matServoBody);
gripMicroServo.position.set(0.012, 0.016, -0.016);
j5Group.add(gripMicroServo);

// Twin Interlocking Metallic Spur Gears (physically counter-rotate with J6!)
function makeSpurGear(radius = 0.0105, teeth = 12) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, 0.005, 20), matBrass);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0042, 0.0048), matBrass);
    t.position.set(Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92, 0);
    t.rotation.z = a + Math.PI / 2;
    g.add(t);
  }
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.007, 8), matBolt);
  screw.rotation.x = Math.PI / 2;
  g.add(screw);
  return g;
}
const gearLeft = makeSpurGear();
gearLeft.position.set(-0.0108, 0.022, 0.013);
const gearRight = makeSpurGear();
gearRight.position.set(0.0108, 0.022, 0.013);
gearRight.rotation.z = Math.PI / 12; // Meshed tooth phase offset!
j5Group.add(gearLeft, gearRight);

// Parallel Mechanical Gripper Jaws — Calibrated so inner silicone pads press EXACTLY ±(jaw_gap_mm / 2)!
// At j6 = 32.73° => jaw_gap = 38.0mm => inner pad face sits at ±19.0mm, flush against our 38.0mm cube!
const fingerLeft = new THREE.Group();
const fingerRight = new THREE.Group();
j5Group.add(fingerLeft, fingerRight);

function buildPrecisionJaw(parent, sign) {
  // Aluminum slide carriage + sculpted curved jaw finger
  const finger = new THREE.Mesh(new RoundedBoxGeometry(0.007, 0.050, 0.015, 2, 0.0018), matAluminum);
  // Placed outward by +sign * 0.0065 so the inner silicone pad face aligns at exact local x = 0.0!
  finger.position.set(sign * 0.0065, 0.044, 0);
  finger.castShadow = true;
  parent.add(finger);

  // Textured high-grip black silicone pad (thickness 3mm, inner face at exact local x = 0.0!)
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.003, 0.028, 0.018, 2, 0.0008), matSilicone);
  pad.position.set(sign * 0.0015, 0.056, 0);
  parent.add(pad);
}
buildPrecisionJaw(fingerLeft, -1);
buildPrecisionJaw(fingerRight, 1);

// Dynamic Flexing Braided Servo Cable Loom routed along the robotic arm joints
const loomMat = new THREE.MeshStandardMaterial({ color: 0x181d26, roughness: 0.75, metalness: 0.12 });
let armLoomMesh = null;

function updateArmCableLoom(fk) {
  if (!fk) return;
  const s = new THREE.Vector3(...fk.shoulder);
  const e = new THREE.Vector3(...fk.elbow);
  const w = new THREE.Vector3(...fk.wrist);
  // Offset cable cleanly along back edge of arm
  const mid1 = s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, 0.012, -0.022));
  const mid2 = e.clone().lerp(w, 0.5).add(new THREE.Vector3(0, 0.018, -0.016));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.045, -0.032),
    s.clone().add(new THREE.Vector3(0, 0.01, -0.028)),
    mid1,
    e.clone().add(new THREE.Vector3(0, 0.016, -0.024)),
    mid2,
    w.clone().add(new THREE.Vector3(0, 0.008, -0.014)),
  ]);
  const geo = new THREE.TubeGeometry(curve, 24, 0.0034, 7, false);
  if (!armLoomMesh) {
    armLoomMesh = new THREE.Mesh(geo, loomMat);
    armLoomMesh.castShadow = true;
    scene.add(armLoomMesh);
  } else {
    armLoomMesh.geometry.dispose();
    armLoomMesh.geometry = geo;
  }
}

// ---------------------------------------------------------------------------
// 6. Photorealistic Beveled 3D-Printed Cubes (RoundedBoxGeometry + Clearcoat)
// ---------------------------------------------------------------------------
const cubeMeshes = new Map();

function syncCubes(cubesData) {
  const seen = new Set();
  for (const c of cubesData) {
    seen.add(c.id);
    let mesh = cubeMeshes.get(c.id);
    if (!mesh) {
      const geo = new RoundedBoxGeometry(c.size_m, c.size_m, c.size_m, 4, 0.0024);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(c.hex),
        roughness: 0.28,
        metalness: 0.04,
        clearcoat: 0.58,
        clearcoatRoughness: 0.22,
        bumpMap: plaMap,
        bumpScale: 0.0005,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      cubeMeshes.set(c.id, mesh);
    }
    mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
    mesh.rotation.y = THREE.MathUtils.degToRad(c.yaw_deg);
    mesh.material.emissive.set(c.status === "IN_GRIPPER" ? c.hex : "#000000");
    mesh.material.emissiveIntensity = c.status === "IN_GRIPPER" ? 0.14 : 0.0;
  }
  for (const [id, mesh] of cubeMeshes.entries()) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      cubeMeshes.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Photorealistic Wi-Fi CSI Visualizer (ZERO Blocky Tiles!)
//    - Smooth Continuous GLSL RF Wave Propagation Floor Shader
//    - Translucent 3D First-Fresnel-Zone Ellipsoids
//    - Anatomically Sculpted Human Operator with Volumetric Fresnel Rim + RF Point Cloud
// ---------------------------------------------------------------------------
const csiNodesGroup = new THREE.Group();
const csiLinksGroup = new THREE.Group();
const csiWaveGroup = new THREE.Group();
roomGroup.add(csiNodesGroup, csiLinksGroup, csiWaveGroup);

const csiNodeMeshes = new Map();
const csiFresnelMeshes = new Map();

// Smooth bilinear 16x16 DataTexture fed into custom GLSL continuous RF wave floor shader
const WAVE_N = 16;
const waveTexData = new Uint8Array(WAVE_N * WAVE_N * 4);
const waveDataTex = new THREE.DataTexture(waveTexData, WAVE_N, WAVE_N, THREE.RGBAFormat);
waveDataTex.magFilter = THREE.LinearFilter;
waveDataTex.minFilter = THREE.LinearFilter;
waveDataTex.needsUpdate = true;

const rfFloorShaderMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uTxPos: { value: new THREE.Vector2(-1.75, -1.55) },
    uOpPos: { value: new THREE.Vector2(0.35, 1.25) },
    uMotion: { value: 0.2 },
    uWaveTex: { value: waveDataTex },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec2 uTxPos;
    uniform vec2 uOpPos;
    uniform float uMotion;
    uniform sampler2D uWaveTex;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vec2 p = vWorldPos.xz;
      float edgeFade = smoothstep(2.15, 1.45, max(abs(p.x), abs(p.y)));

      // Smooth 2.437 GHz traveling circular carrier wavefronts from TX Router
      float dTx = length(p - uTxPos);
      float carrier = pow(0.5 + 0.5 * sin(dTx * 11.5 - uTime * 5.2), 4.0);
      float txFalloff = exp(-dTx * 0.42);

      // Smooth RF Doppler scatter ripples radiating around tracked human operator
      float dOp = length(p - uOpPos);
      float opHalo = exp(-dOp * dOp * 2.2);
      float opRing = pow(0.5 + 0.5 * sin(dOp * 16.0 - uTime * 6.5), 5.0) * exp(-dOp * 1.15);

      // Smooth bilinear CSI spatial disturbance field from backend
      float fieldVal = texture2D(uWaveTex, vUv).r;

      vec3 colCyan = vec3(0.08, 0.72, 0.92);
      vec3 colAmber = vec3(0.95, 0.52, 0.18);
      vec3 color = colCyan * (carrier * txFalloff * 0.55 + fieldVal * 0.28 + opRing * 0.75);
      color += mix(colCyan, colAmber, clamp(uMotion * 1.2, 0.0, 1.0)) * opHalo * 0.48;

      float alpha = clamp((carrier * txFalloff * 0.34 + opRing * 0.46 + opHalo * 0.38 + fieldVal * 0.18) * edgeFade, 0.0, 0.72);
      gl_FragColor = vec4(color, alpha);
    }
  `,
});

const rfFloorPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), rfFloorShaderMat);
rfFloorPlane.rotation.x = -Math.PI / 2;
rfFloorPlane.position.y = -TABLE_HEIGHT + 0.004;
csiWaveGroup.add(rfFloorPlane);

// Sculpted High-Detail Volumetric Fresnel Human Operator (CMU DensePose / RuView Aesthetic)
const operatorGroup = new THREE.Group();
roomGroup.add(operatorGroup);

const holoOperatorShader = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.FrontSide,
  uniforms: {
    uTime: { value: 0 },
    uEnergy: { value: 0.25 },
  },
  vertexShader: `
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewDir = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uEnergy;
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    void main() {
      float ndv = clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0);
      float fresnel = pow(1.0 - ndv, 2.35);
      // Smooth RF horizontal scan band sweeping upward along torso
      float scan = pow(0.5 + 0.5 * sin(vWorldPos.y * 26.0 - uTime * 3.8), 6.0);
      vec3 coreCol = vec3(0.05, 0.20, 0.38);
      vec3 rimCol = mix(vec3(0.14, 0.86, 0.98), vec3(0.68, 0.42, 0.98), clamp(uEnergy * 0.9, 0.0, 1.0));
      vec3 col = mix(coreCol, rimCol, fresnel) + rimCol * scan * 0.28;
      float alpha = clamp(0.14 + fresnel * 0.74 + scan * 0.12, 0.0, 0.88);
      gl_FragColor = vec4(col, alpha);
    }
  `,
});

const opBodyRoot = new THREE.Group();
opBodyRoot.position.y = -TABLE_HEIGHT;
operatorGroup.add(opBodyRoot);

// Anatomically sculpted torso via smooth LatheGeometry profile
const torsoPts = [
  new THREE.Vector2(0.00, 0.82),
  new THREE.Vector2(0.14, 0.84), // Pelvis/hips
  new THREE.Vector2(0.13, 0.98), // Waist
  new THREE.Vector2(0.155, 1.18), // Ribcage
  new THREE.Vector2(0.185, 1.36), // Broad shoulders
  new THREE.Vector2(0.085, 1.44), // Collar/neck base
  new THREE.Vector2(0.058, 1.48), // Neck
  new THREE.Vector2(0.00, 1.49),
];
const opTorso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 32), holoOperatorShader);
opTorso.scale.set(1.05, 1.0, 0.68); // Natural human chest width > depth!
opBodyRoot.add(opTorso);

// Sculpted ovoid head
const opHead = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 24), holoOperatorShader);
opHead.scale.set(0.92, 1.14, 1.0);
opHead.position.set(0, 1.60, 0.01);
opBodyRoot.add(opHead);

// Tapered articulated arms & legs pivoting naturally at shoulders & hips
function makeLimbPivot(x, y, len, rTop, rBot) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const seg = new THREE.Mesh(new THREE.CapsuleGeometry((rTop + rBot) * 0.5, len, 12, 20), holoOperatorShader);
  seg.position.y = -len * 0.5 - rTop * 0.5;
  pivot.add(seg);
  return pivot;
}
const opArmL = makeLimbPivot(-0.22, 1.35, 0.48, 0.048, 0.036);
const opArmR = makeLimbPivot(0.22, 1.35, 0.48, 0.048, 0.036);
const opLegL = makeLimbPivot(-0.095, 0.84, 0.72, 0.068, 0.048);
const opLegR = makeLimbPivot(0.095, 0.84, 0.72, 0.068, 0.048);
opBodyRoot.add(opArmL, opArmR, opLegL, opLegR);

// Subtle RF Backscatter Point-Cloud Shell shimmering around operator torso/head (DensePose signature!)
const pcCount = 320;
const pcPos = new Float32Array(pcCount * 3);
for (let i = 0; i < pcCount; i++) {
  const h = 0.25 + Math.random() * 1.45;
  const ang = Math.random() * Math.PI * 2;
  const rad = (h > 1.45 ? 0.12 : h > 0.85 ? 0.21 : 0.16) * (0.85 + Math.random() * 0.35);
  pcPos[i * 3] = Math.cos(ang) * rad;
  pcPos[i * 3 + 1] = h;
  pcPos[i * 3 + 2] = Math.sin(ang) * rad * 0.78;
}
const pcGeo = new THREE.BufferGeometry();
pcGeo.setAttribute("position", new THREE.BufferAttribute(pcPos, 3));
const opPointCloud = new THREE.Points(
  pcGeo,
  new THREE.PointsMaterial({
    color: 0x67e8f9,
    size: 0.015,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
opBodyRoot.add(opPointCloud);

// Sleek Ground Tracking Reticle Ring beneath operator's feet
const opHalo = new THREE.Mesh(
  new THREE.RingGeometry(0.27, 0.295, 56),
  new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);
opHalo.rotation.x = -Math.PI / 2;
opHalo.position.y = 0.012;
opBodyRoot.add(opHalo);

function ensureCSINodes(nodes) {
  if (csiNodeMeshes.size > 0 || !nodes) return;
  const txNode = nodes.find((n) => n.role === "TX_ROUTER");

  for (const n of nodes) {
    const g = new THREE.Group();
    const isTx = n.role === "TX_ROUTER";
    g.position.set(n.pos[0], -TABLE_HEIGHT + n.pos[1], n.pos[2]);

    // Sleek black tripod pole + circular base
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.014, n.pos[1], 16), matDarkAnodized);
    pole.position.y = -n.pos[1] * 0.5;
    g.add(pole);
    const standFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.014, 24), matDarkAnodized);
    standFoot.position.y = -n.pos[1] + 0.007;
    g.add(standFoot);

    // Detailed Router or ESP32-S3 Enclosure
    const box = new THREE.Mesh(
      new RoundedBoxGeometry(isTx ? 0.18 : 0.078, isTx ? 0.032 : 0.022, isTx ? 0.12 : 0.048, 2, 0.004),
      isTx ? matDarkAnodized : new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.42 })
    );
    g.add(box);

    const antOffsets = isTx ? [-0.065, 0.0, 0.065] : [0.0];
    for (const ax of antOffsets) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0048, 0.15, 12), matDarkAnodized);
      ant.position.set(ax, 0.075, -0.02);
      g.add(ant);
    }

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 12, 12),
      new THREE.MeshBasicMaterial({ color: isTx ? 0xf59e0b : 0x22d3ee })
    );
    led.position.set(0, 0.018, 0.025);
    g.add(led);

    csiNodesGroup.add(g);
    csiNodeMeshes.set(n.id, g);

    // Translucent 3D First-Fresnel-Zone Ellipsoid + Central RF Line along TX <-> RX
    if (!isTx && txNode) {
      const p0 = new THREE.Vector3(txNode.pos[0], -TABLE_HEIGHT + txNode.pos[1], txNode.pos[2]);
      const p1 = new THREE.Vector3(n.pos[0], -TABLE_HEIGHT + n.pos[1], n.pos[2]);
      const dist = p0.distanceTo(p1);
      const mid = p0.clone().lerp(p1, 0.5);

      // Sleek translucent 1st Fresnel zone wireframe envelope (unobtrusive & ultra-scientific)
      const r1 = Math.sqrt(0.123 * dist * 0.25);
      const fresnelMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.045,
        wireframe: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ellipGeo = new THREE.SphereGeometry(1.0, 20, 10);
      const ellip = new THREE.Mesh(ellipGeo, fresnelMat);
      ellip.position.copy(mid);
      ellip.lookAt(p1);
      ellip.scale.set(r1 * 0.36, r1 * 0.36, dist * 0.5);
      csiLinksGroup.add(ellip);

      // Sleek central RF link ray
      const lineGeo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.38 });
      const line = new THREE.Line(lineGeo, lineMat);
      csiLinksGroup.add(line);

      // Animated RF packet pulse bead traveling along TX -> RX link
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x67e8f9 })
      );
      csiLinksGroup.add(pulse);

      csiFresnelMeshes.set(n.id, { ellip, line, pulse, p0, p1 });
    }
  }
}

function updateCSI3D(csi, elapsedSec) {
  if (!csi) return;
  ensureCSINodes(csi.nodes);

  const op = csi.operator;
  operatorGroup.position.set(op.pos[0], 0, op.pos[2]);
  operatorGroup.rotation.y = op.yaw_rad;

  holoOperatorShader.uniforms.uTime.value = elapsedSec;
  holoOperatorShader.uniforms.uEnergy.value = op.motion_energy;

  // Breathing chest expansion synced to real BPM
  const breathFreq = (op.breathing_bpm / 60.0) * Math.PI * 2;
  const breath = 1.0 + 0.032 * Math.sin(elapsedSec * breathFreq);
  opTorso.scale.set(1.05 * breath, 1.0, 0.68 * breath);

  // Smooth walking gait or observant lean
  const walkAmp = Math.min(0.42, op.speed_mps * 1.35);
  const swing = Math.sin(elapsedSec * 7.2) * walkAmp;
  opLegL.rotation.x = swing;
  opLegR.rotation.x = -swing;
  opArmL.rotation.x = -swing * 0.65 - 0.18;
  opArmR.rotation.x = swing * 0.65 - 0.18;

  opHalo.scale.setScalar(1.0 + 0.08 * Math.sin(elapsedSec * 3.0));
  opPointCloud.rotation.y = elapsedSec * 0.25;

  // Update Continuous GLSL RF Floor Wave Shader
  const tx = csi.nodes.find((n) => n.role === "TX_ROUTER");
  rfFloorShaderMat.uniforms.uTime.value = elapsedSec;
  if (tx) rfFloorShaderMat.uniforms.uTxPos.value.set(tx.pos[0], tx.pos[2]);
  rfFloorShaderMat.uniforms.uOpPos.value.set(op.pos[0], op.pos[2]);
  rfFloorShaderMat.uniforms.uMotion.value = op.motion_energy;

  const wf = csi.wave_field;
  if (wf && wf.length === WAVE_N * WAVE_N) {
    for (let i = 0; i < wf.length; i++) {
      const v = Math.min(255, Math.floor(wf[i] * 255));
      waveTexData[i * 4] = v;
      waveTexData[i * 4 + 1] = v;
      waveTexData[i * 4 + 2] = v;
      waveTexData[i * 4 + 3] = 255;
    }
    waveDataTex.needsUpdate = true;
  }

  // Update 3D Fresnel Ellipsoids & traveling RF packet pulses
  let linkIdx = 0;
  for (const n of csi.nodes) {
    const entry = csiFresnelMeshes.get(n.id);
    if (!entry) continue;
    const d = n.fresnel_disturbance || 0;
    entry.ellip.material.color.setHSL(0.54 - d * 0.44, 0.92, 0.56);
    entry.ellip.material.opacity = 0.025 + d * 0.085;
    entry.line.material.color.setHSL(0.54 - d * 0.44, 0.92, 0.62);
    entry.line.material.opacity = 0.22 + d * 0.55;
    const u = (elapsedSec * 0.65 + linkIdx * 0.33) % 1.0;
    entry.pulse.position.lerpVectors(entry.p0, entry.p1, u);
    entry.pulse.material.color.setHSL(0.54 - d * 0.44, 0.95, 0.68);
    linkIdx++;
  }
}

// ---------------------------------------------------------------------------
// 8. LIVE 3D VIRTUAL ESP32-CAM LENS -> REAL PYTHON OPENCV PIPELINE!
//    Renders directly from the actual OV2640 lens at (0, 0.52, 0.22), FOV=56°
// ---------------------------------------------------------------------------
const virtualCam = new THREE.PerspectiveCamera(56.0, 4 / 3, 0.05, 2.0);
virtualCam.position.set(0.0, 0.52, 0.22);
virtualCam.up.set(0, 0, -1);
virtualCam.lookAt(0.0, 0.0, 0.22);

const vCamW = 320, vCamH = 240;
const vCamRT = new THREE.WebGLRenderTarget(vCamW, vCamH);
const vCamPixels = new Uint8Array(vCamW * vCamH * 4);
const vCamCanvas = document.createElement("canvas");
vCamCanvas.width = vCamW;
vCamCanvas.height = vCamH;
const vCamCtx = vCamCanvas.getContext("2d");
const vCamImgData = vCamCtx.createImageData(vCamW, vCamH);

let lastVCamPush = 0;
let vCamBusy = false;

function pushLive3DCameraToOpenCV(nowMs) {
  if (vCamBusy || nowMs - lastVCamPush < 120) return;
  if (!latestState || latestState.vision.source_mode !== "synthetic") return;
  lastVCamPush = nowMs;
  vCamBusy = true;

  // Hide purely digital overlays so the virtual optical camera sees ONLY physical objects!
  const prevCone = camCone.visible;
  const prevWave = csiWaveGroup.visible;
  const prevLinks = csiLinksGroup.visible;
  camCone.visible = false;
  csiWaveGroup.visible = false;
  csiLinksGroup.visible = false;

  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(vCamRT);
  renderer.render(scene, virtualCam);
  renderer.readRenderTargetPixels(vCamRT, 0, 0, vCamW, vCamH, vCamPixels);
  renderer.setRenderTarget(prevRT);

  camCone.visible = prevCone;
  csiWaveGroup.visible = prevWave;
  csiLinksGroup.visible = prevLinks;

  // Flip Y (WebGL bottom-up -> Canvas top-down)
  const dst = vCamImgData.data;
  const rowBytes = vCamW * 4;
  for (let y = 0; y < vCamH; y++) {
    const srcOff = (vCamH - 1 - y) * rowBytes;
    const dstOff = y * rowBytes;
    dst.set(vCamPixels.subarray(srcOff, srcOff + rowBytes), dstOff);
  }
  vCamCtx.putImageData(vCamImgData, 0, 0);

  vCamCanvas.toBlob(
    async (blob) => {
      try {
        if (blob) {
          await fetch("/api/camera/virtual_frame", {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: blob,
          });
        }
      } catch (_) {
      } finally {
        vCamBusy = false;
      }
    },
    "image/jpeg",
    0.78
  );
}

// ---------------------------------------------------------------------------
// 9. Smooth Camera Presets & Telemetry UI Sync
// ---------------------------------------------------------------------------
const CAM_PRESETS = {
  close: { pos: new THREE.Vector3(0.45, 0.36, 0.50), target: new THREE.Vector3(0.0, 0.11, 0.16) },
  iso:   { pos: new THREE.Vector3(0.82, 0.64, 0.88), target: new THREE.Vector3(-0.04, 0.12, 0.14) },
  room:  { pos: new THREE.Vector3(2.45, 1.88, 2.75), target: new THREE.Vector3(0.0, -0.05, 0.18) },
  top:   { pos: new THREE.Vector3(0.0, 1.02, 0.23),  target: new THREE.Vector3(0.0, 0.0, 0.20) },
};
let camAnim = null;

function flyCamera(key) {
  const p = CAM_PRESETS[key];
  if (!p) return;
  camAnim = {
    startPos: camera.position.clone(),
    endPos: p.pos.clone(),
    startTarget: controls.target.clone(),
    endTarget: p.target.clone(),
    t: 0,
  };
}

let ws = null;
let latestState = null;
let isDraggingSlider = false;

const JOINT_META = [
  { key: "j1_base", label: "J1 Taban (DS3218)", min: -135, max: 135 },
  { key: "j2_shoulder", label: "J2 Omuz (DS3218)", min: -75, max: 82 },
  { key: "j3_elbow", label: "J3 Dirsek (DS3218)", min: -110, max: 125 },
  { key: "j4_wrist_pitch", label: "J4 Bilek Eğim (MG996R)", min: -100, max: 100 },
  { key: "j5_wrist_roll", label: "J5 Bilek Dönüş (MG90S)", min: -180, max: 180 },
  { key: "j6_gripper", label: "J6 Kıskaç (MG90S)", min: 0, max: 90 },
];

const sliderContainer = document.getElementById("jointSliders");
const jointSliderEls = {};
const jointValEls = {};

for (const jm of JOINT_META) {
  const row = document.createElement("div");
  row.className = "slider-row";
  row.innerHTML = `
    <div class="slider-head"><span>${jm.label}</span><span id="val_${jm.key}">0°</span></div>
    <input type="range" id="sl_${jm.key}" min="${jm.min}" max="${jm.max}" step="1" value="0" />
  `;
  sliderContainer.appendChild(row);
  const sl = row.querySelector("input");
  const vl = row.querySelector(`#val_${jm.key}`);
  jointSliderEls[jm.key] = sl;
  jointValEls[jm.key] = vl;

  sl.addEventListener("pointerdown", () => { isDraggingSlider = true; });
  sl.addEventListener("pointerup", () => { isDraggingSlider = false; });
  sl.addEventListener("input", () => {
    vl.textContent = `${sl.value}°`;
    sendCommand({ action: "set_joints", joints: { [jm.key]: Number(sl.value) } });
  });
}

async function sendCommand(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
}

const csiCanvas = document.getElementById("csiChart");
const csiCtx = csiCanvas.getContext("2d");

function drawCSISpectrum(amps) {
  if (!amps || !amps.length) return;
  const w = csiCanvas.width, h = csiCanvas.height;
  csiCtx.clearRect(0, 0, w, h);

  csiCtx.strokeStyle = "rgba(148,163,184,0.12)";
  csiCtx.lineWidth = 1;
  for (let y = 20; y < h; y += 24) {
    csiCtx.beginPath(); csiCtx.moveTo(0, y); csiCtx.lineTo(w, y); csiCtx.stroke();
  }
  const grad = csiCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(34, 211, 238, 0.42)");
  grad.addColorStop(1, "rgba(20, 184, 166, 0.02)");

  csiCtx.beginPath();
  amps.forEach((a, i) => {
    const x = (i / (amps.length - 1)) * w;
    const y = h - 8 - a * (h - 18);
    if (i === 0) csiCtx.moveTo(x, y);
    else csiCtx.lineTo(x, y);
  });
  csiCtx.strokeStyle = "#22d3ee";
  csiCtx.lineWidth = 2;
  csiCtx.stroke();
  csiCtx.lineTo(w, h);
  csiCtx.lineTo(0, h);
  csiCtx.closePath();
  csiCtx.fillStyle = grad;
  csiCtx.fill();
}

const roomPad = document.getElementById("roomPad");
const padCtx = roomPad.getContext("2d");

function drawRoomPad(csi) {
  const w = roomPad.width, h = roomPad.height;
  padCtx.clearRect(0, 0, w, h);
  const toCanvas = (rx, rz) => [((rx + 2.1) / 4.2) * w, ((rz + 2.1) / 4.2) * h];

  padCtx.strokeStyle = "rgba(56,189,248,0.12)";
  padCtx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    padCtx.beginPath(); padCtx.moveTo((w * i) / 4, 0); padCtx.lineTo((w * i) / 4, h); padCtx.stroke();
    padCtx.beginPath(); padCtx.moveTo(0, (h * i) / 4); padCtx.lineTo(w, (h * i) / 4); padCtx.stroke();
  }

  const [tx1, tz1] = toCanvas(-0.52, -0.22);
  const [tx2, tz2] = toCanvas(0.52, 0.52);
  padCtx.fillStyle = "rgba(30, 41, 59, 0.9)";
  padCtx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  padCtx.fillRect(tx1, tz1, tx2 - tx1, tz2 - tz1);
  padCtx.strokeRect(tx1, tz1, tx2 - tx1, tz2 - tz1);
  padCtx.fillStyle = "#94a3b8";
  padCtx.font = "9px Consolas";
  padCtx.fillText("ROBOT MASA", tx1 + 8, (tz1 + tz2) / 2 + 3);

  const txNode = csi.nodes.find((n) => n.role === "TX_ROUTER");
  if (txNode) {
    const [ax, az] = toCanvas(txNode.pos[0], txNode.pos[2]);
    for (const n of csi.nodes) {
      const [nx, nz] = toCanvas(n.pos[0], n.pos[2]);
      if (n.role !== "TX_ROUTER") {
        padCtx.strokeStyle = `rgba(34,211,238,${0.25 + n.fresnel_disturbance * 0.65})`;
        padCtx.beginPath(); padCtx.moveTo(ax, az); padCtx.lineTo(nx, nz); padCtx.stroke();
      }
      padCtx.fillStyle = n.role === "TX_ROUTER" ? "#f59e0b" : "#38bdf8";
      padCtx.beginPath(); padCtx.arc(nx, nz, 4, 0, Math.PI * 2); padCtx.fill();
      padCtx.fillStyle = "#cbd5e1";
      padCtx.fillText(n.id, nx + 5, nz + 3);
    }
  }

  const [ox, oz] = toCanvas(csi.operator.pos[0], csi.operator.pos[2]);
  padCtx.fillStyle = "rgba(34, 211, 238, 0.25)";
  padCtx.beginPath(); padCtx.arc(ox, oz, 12, 0, Math.PI * 2); padCtx.fill();
  padCtx.fillStyle = "#22d3ee";
  padCtx.beginPath(); padCtx.arc(ox, oz, 5, 0, Math.PI * 2); padCtx.fill();
  padCtx.fillStyle = "#f8fafc";
  padCtx.fillText("SEN", ox + 8, oz + 3);
}

let draggingPad = false;
function handlePadEvent(e) {
  const rect = roomPad.getBoundingClientRect();
  const wx = ((e.clientX - rect.left) / rect.width) * 4.2 - 2.1;
  const wz = ((e.clientY - rect.top) / rect.height) * 4.2 - 2.1;
  sendCommand({ action: "set_operator_pos", x: wx, z: wz });
}
roomPad.addEventListener("pointerdown", (e) => { draggingPad = true; handlePadEvent(e); });
window.addEventListener("pointerup", () => { draggingPad = false; });
roomPad.addEventListener("pointermove", (e) => { if (draggingPad) handlePadEvent(e); });

let lastPSUUpdate = 0;

function applyTelemetry(data) {
  latestState = data;
  buildZonePads(data.zones);
  syncCubes(data.cubes);

  // Update 6-DOF Robotic Arm Joints (Exact 0.000mm kinematic alignment!)
  const j = data.robot.joints_deg;
  j1Group.rotation.y = THREE.MathUtils.degToRad(j.j1_base);
  j2Group.rotation.x = THREE.MathUtils.degToRad(j.j2_shoulder);
  j3Group.rotation.x = THREE.MathUtils.degToRad(j.j3_elbow);
  j4Group.rotation.x = THREE.MathUtils.degToRad(j.j4_wrist_pitch);
  j5Group.rotation.y = THREE.MathUtils.degToRad(j.j5_wrist_roll);

  // Exact Millimeter-Calibrated Gripper Opening (gap_mm = 22 + (j6/90)*44)
  const gapM = (22.0 + (j.j6_gripper / 90.0) * 44.0) / 1000.0;
  fingerLeft.position.x = -gapM * 0.5;
  fingerRight.position.x = gapM * 0.5;
  // Counter-rotate meshed twin spur gears realistically with J6!
  const gearRad = THREE.MathUtils.degToRad(j.j6_gripper * 1.4);
  gearLeft.rotation.z = gearRad;
  gearRight.rotation.z = -gearRad + Math.PI / 12;

  updateArmCableLoom(data.robot.fk_m);

  // Update Live 3D Lab Power Supply OLED Display on the Workbench!
  const el = data.robot.electrical;
  const now = performance.now();
  if (now - lastPSUUpdate > 160) {
    lastPSUUpdate = now;
    updatePSUScreen(el.bus_voltage_v, el.total_current_a, el.power_w);
  }

  // Mission Banner
  document.getElementById("missionPhase").textContent = data.system.mission_phase;
  document.getElementById("sortedCount").textContent = data.system.sorted_count;
  const tip = data.robot.fk_m.tip;
  document.getElementById("tipCoords").textContent =
    `${(tip[0] * 100).toFixed(1)}, ${(tip[1] * 100).toFixed(1)}, ${(tip[2] * 100).toFixed(1)} cm`;

  // Top Pills
  const pillCam = document.getElementById("pillCam");
  pillCam.innerHTML = `<span class="dot"></span>CAM: ${data.vision.using_live_3d_cam ? "3D LENS" : (data.vision.source_mode === "synthetic" ? "SANAL" : data.vision.source_mode.toUpperCase())}`;
  const pillEsp = document.getElementById("pillEsp");
  pillEsp.className = `pill ${data.esp32.connected ? "online" : "sim"}`;
  pillEsp.innerHTML = `<span class="dot"></span>ESP32: ${data.esp32.connected ? data.esp32.port : "SİM"}`;

  const pillCsi = document.getElementById("pillCsi");
  pillCsi.className = `pill ${data.wifi_csi.live_udp_connected ? "online" : "sim"}`;
  pillCsi.innerHTML = `<span class="dot"></span>CSI: ${data.wifi_csi.live_udp_connected ? "UDP" : "SİM"}`;

  const pillUe5 = document.getElementById("pillUe5");
  pillUe5.className = `pill ${data.system.ue5_clients > 0 ? "online" : ""}`;
  pillUe5.innerHTML = `<span class="dot"></span>UE5: ${data.system.ue5_clients}`;

  // Vision & Active Cube Inspector
  document.getElementById("camFpsBadge").textContent = `${data.vision.fps.toFixed(1)} FPS`;
  const ac = data.vision.active_cube;
  if (ac) {
    document.getElementById("cubeSwatch").style.background = ac.hex;
    document.getElementById("cubeTitle").textContent = `${ac.id} • ${ac.color_tr}`;
    document.getElementById("cubeZoneBadge").textContent = ac.target_zone;
    document.getElementById("cubeMaterial").textContent = ac.material;
    document.getElementById("cubeConfBadge").textContent = `${ac.confidence_pct}% GÜVEN`;
    document.getElementById("cubeDims").textContent = `${ac.size_mm[0]}×${ac.size_mm[1]}×${ac.size_mm[2]} mm`;
    document.getElementById("cubeMass").textContent = `${ac.volume_cm3} cm³ • ${ac.est_weight_g} g`;
    document.getElementById("cubePos").textContent =
      `${(ac.world_pos_m[0] * 100).toFixed(1)}, ${(ac.world_pos_m[1] * 100).toFixed(1)}, ${(ac.world_pos_m[2] * 100).toFixed(1)} cm`;
    document.getElementById("cubeYaw").textContent = `${ac.yaw_deg.toFixed(1)}°`;
    document.getElementById("cubeRgb").textContent = `(${ac.rgb.join(", ")})`;
    document.getElementById("cubeHsv").textContent = `(${ac.hsv.join(", ")})`;
  }

  document.getElementById("cubeList").innerHTML = data.cubes
    .map(
      (c) => `
      <div class="cube-row ${c.status === "LOCKED" || c.status === "IN_GRIPPER" ? "active" : ""}">
        <div class="cube-row-left">
          <span class="mini-dot" style="background:${c.hex};"></span>
          <span>${c.id} (${c.color_tr})</span>
        </div>
        <span style="color:#94a3b8;">${c.status} → ${c.target_zone}</span>
      </div>`
    )
    .join("");

  // Wi-Fi CSI Telemetry UI
  const csi = data.wifi_csi;
  document.getElementById("csiPresenceBadge").textContent = `${Math.round(csi.operator.presence_confidence * 100)}% VARLIK`;
  document.getElementById("csiOpPos").textContent = `${csi.operator.pos[0].toFixed(2)}, ${csi.operator.pos[2].toFixed(2)} m`;
  document.getElementById("csiPosture").textContent = `${csi.operator.posture} (${Math.round(csi.operator.motion_energy * 100)}%)`;
  document.getElementById("csiBreath").textContent = `${csi.operator.breathing_bpm.toFixed(1)} BPM`;
  document.getElementById("csiHeart").textContent = `${Math.round(csi.operator.heart_rate_bpm)} BPM`;
  drawCSISpectrum(csi.subcarriers_amp);
  drawRoomPad(csi);

  document.getElementById("csiNodeList").innerHTML = csi.nodes
    .filter((n) => n.role !== "TX_ROUTER")
    .map(
      (n) => `
      <div class="node-row">
        <span>${n.id}</span>
        <span style="color:#94a3b8;">${n.rssi_dbm} dBm</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(n.fresnel_disturbance * 100)}%"></div></div>
      </div>`
    )
    .join("");

  // Joint Sliders Sync & Detailed PCA9685 PWM + Electrical Telemetry
  document.getElementById("armModeBadge").textContent =
    data.system.mode === "auto_pick_place" ? "OTONOM" : "MANUEL";
  if (!isDraggingSlider) {
    for (const jm of JOINT_META) {
      const val = Math.round(j[jm.key]);
      jointSliderEls[jm.key].value = val;
      jointValEls[jm.key].textContent = `${val}°`;
    }
  }

  document.getElementById("elecVolt").textContent = `${el.bus_voltage_v.toFixed(2)} V • ${el.ubec_temp_c}°C`;
  document.getElementById("elecAmp").textContent = `${el.total_current_a.toFixed(2)} A • ${el.power_w.toFixed(1)} W`;
  document.getElementById("elecTauSh").textContent = `${el.shoulder_torque_nm.toFixed(2)} N·m (${el.shoulder_torque_kgcm} kg·cm)`;
  document.getElementById("elecJawGap").textContent = `${el.jaw_gap_mm.toFixed(1)} mm`;

  if (el.pwm_channels) {
    document.getElementById("servoCurrentBars").innerHTML = Object.entries(el.pwm_channels)
      .map(
        ([k, ch]) => `
        <div class="node-row" style="grid-template-columns: 32px 104px 1fr;">
          <span>CH${ch.ch}</span>
          <span style="color:#94a3b8;">${ch.pwm_us}µs • ${Math.round(ch.current_ma)}mA</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round(ch.current_ma / 14))}%"></div></div>
        </div>`
      )
      .join("");
  }

  // UE5 Coordinates & Serial Ports
  const ueTip = data.robot.ue5_tip_cm;
  const ueOp = csi.operator.ue5_pos_cm;
  document.getElementById("ue5TipPos").textContent = `${ueTip.x}, ${ueTip.y}, ${ueTip.z} cm`;
  document.getElementById("ue5OpPos").textContent = `${ueOp.x}, ${ueOp.y}, ${ueOp.z} cm`;

  const portSel = document.getElementById("serialPortSelect");
  if (portSel.options.length <= 1 && data.esp32.available_ports.length > 0) {
    for (const p of data.esp32.available_ports) {
      const opt = document.createElement("option");
      opt.value = p.device;
      opt.textContent = `${p.device} — ${p.description.slice(0, 22)}`;
      portSel.appendChild(opt);
    }
  }

  document.getElementById("logBox").innerHTML = data.logs
    .slice()
    .reverse()
    .map((l) => `<div class="log-line"><span class="t">[${l.time}]</span> <span class="tag">${l.tag}</span> ${l.msg}</div>`)
    .join("");
}

// ---------------------------------------------------------------------------
// 10. UI Event Bindings & Main Render Loop
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-cam]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-cam]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    flyCamera(btn.dataset.cam);
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

document.getElementById("btnPause").addEventListener("click", async (e) => {
  await sendCommand({ action: "toggle_pause" });
  e.target.textContent = e.target.textContent === "Duraklat" ? "Devam Et" : "Duraklat";
});
document.getElementById("btnResetCubes").addEventListener("click", () => sendCommand({ action: "reset_cubes" }));
document.getElementById("btnModeAuto").addEventListener("click", () => sendCommand({ action: "set_mode", mode: "auto_pick_place" }));
document.getElementById("btnModeManual").addEventListener("click", () => sendCommand({ action: "set_mode", mode: "manual_joints" }));
document.getElementById("btnGoHome").addEventListener("click", () => sendCommand({ action: "go_home" }));

document.getElementById("speedSlider").addEventListener("input", (e) => {
  const sp = Number(e.target.value);
  document.getElementById("speedVal").textContent = `${sp.toFixed(1)}x`;
  sendCommand({ action: "set_speed", speed: sp });
});

document.querySelectorAll("[data-camsrc]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-camsrc]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.camsrc;
    document.getElementById("espCamUrlWrap").style.display = mode === "esp32cam" ? "flex" : "none";
    sendCommand({ action: "set_camera", source_mode: mode, esp32_cam_url: document.getElementById("espCamUrl").value });
  });
});
document.getElementById("btnApplyCamUrl").addEventListener("click", () => {
  sendCommand({ action: "set_camera", source_mode: "esp32cam", esp32_cam_url: document.getElementById("espCamUrl").value });
});
document.querySelectorAll("[data-csimode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-csimode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sendCommand({ action: "set_csi_mode", mode: btn.dataset.csimode });
  });
});
document.querySelectorAll("[data-csibeh]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-csibeh]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sendCommand({ action: "set_csi_behavior", behavior: btn.dataset.csibeh });
  });
});
document.getElementById("btnConnectEsp").addEventListener("click", () => {
  const port = document.getElementById("serialPortSelect").value;
  if (port) sendCommand({ action: "connect_esp32", port });
});

function bindToggle(id, targetObj) {
  const el = document.getElementById(id);
  el.addEventListener("click", () => {
    const on = el.classList.toggle("on");
    targetObj.visible = on;
  });
}
bindToggle("togWaves", csiWaveGroup);
bindToggle("togLinks", csiLinksGroup);
bindToggle("togRoom", roomGroup);
bindToggle("togCamCone", camCone);
document.getElementById("togHud").addEventListener("click", (e) => {
  const hidden = document.body.classList.toggle("hud-hidden");
  e.target.classList.toggle("on", hidden);
});

function connectWS() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws/twin?client=web`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.robot) applyTelemetry(msg);
    } catch (_) {}
  };
  ws.onclose = () => {
    document.getElementById("pillWs").className = "pill";
    setTimeout(connectWS, 1200);
  };
  ws.onopen = () => {
    document.getElementById("pillWs").className = "pill online";
  };
}
connectWS();

const clock = new THREE.Clock();
function animate(nowMs) {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + 0.045);
    const s = camAnim.t * camAnim.t * (3 - 2 * camAnim.t);
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, s);
    controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, s);
    if (camAnim.t >= 1) camAnim = null;
  }

  if (latestState) {
    updateCSI3D(latestState.wifi_csi, elapsed);
    pushLive3DCameraToOpenCV(nowMs);
  }

  // Subtle realistic ESP32 serial TX LED blink
  espLedMat.emissiveIntensity = Math.sin(elapsed * 18.0) > 0.2 ? 2.6 : 0.3;

  controls.update();
  composer.render();
}
animate(0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
