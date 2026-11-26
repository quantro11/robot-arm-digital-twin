import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { L0_BASE_HEIGHT, L1_UPPER_ARM, L2_FOREARM, gripperGapMm } from "../engine/kinematics.js";
import { CAM_FOV_V_DEG, CAM_H, CAM_POS, CAM_W, COLOR_PROFILES } from "../engine/vision.js";
import {
  createStudioEnvironment,
  make2020VSlotMap,
  makeBrushedAluminumMap,
  makeCarbonPLAMap,
  makeConcreteFloorMap,
  makeESDMatMap,
  makeLabWhiteboardMap,
  makeOakButcherBlockMap,
} from "./textures.js";

RectAreaLightUniformsLib.init();

const TABLE_HEIGHT = 0.78;

export class RoboticsLabScene {
  constructor(mountEl) {
    this.mountEl = mountEl;
    this.lightingTheme = "studio"; // "studio" (photorealistic daylight lab) | "night" (RF dark lab)
    this.ultraQuality = true;      // GTAO Ambient Occlusion + Planar Floor Reflections

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    mountEl.appendChild(this.renderer.domElement);

    // 2. Scene + Studio HDRI Reflections
    this.scene = new THREE.Scene();
    this._studioEnv = createStudioEnvironment(this.renderer, "studio");
    this._nightEnv = createStudioEnvironment(this.renderer, "night");
    this.scene.environment = this._studioEnv;
    this.scene.environmentIntensity = 0.92;
    this.scene.background = new THREE.Color(0xcbd5e1);
    this.scene.fog = new THREE.FogExp2(0xcbd5e1, 0.048);

    // 3. Camera + Orbit Controls
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 35);
    this.camera.position.set(0.46, 0.35, 0.50);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0.0, 0.11, 0.16);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.22;
    this.controls.maxDistance = 5.6;

    // 4. Cinema Post-Processing Pipeline: Render -> GTAO Ambient Occlusion -> Selective Bloom -> SMAA -> ACES
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.gtaoPass = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.updateGtaoMaterial({
      radius: 0.16,
      distanceExponent: 1.7,
      thickness: 0.45,
      scale: 1.05,
      samples: 12,
      distanceFallOff: 1.0,
    });
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 4,
      rings: 2,
      samples: 8,
    });
    this.composer.addPass(this.gtaoPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.16,
      0.34,
      0.96
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight));
    this.composer.addPass(new OutputPass());

    // 5. Build Lighting, Lab Architecture, Workbench, Electronics, Robot Arm & Wi-Fi CSI
    this._setupLighting();
    this._setupSharedMaterials();
    this._buildLabRoom();
    this._buildWorkbenchAndElectronics();
    this._buildRobotArm();
    this._buildWiFiCSI();
    this._setupVirtualOV2640Camera();

    this.cubeMeshes = new Map();
    this.customStlMesh = null;
    this._camAnim = null;
    this._lastPsuMs = 0;

    window.addEventListener("resize", () => this.onResize());
  }

  _setupLighting() {
    this.hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x475569, 0.72);
    this.scene.add(this.hemiLight);

    // 4K Crisp Key Shadow Sun/Lab Lamp
    this.keyLight = new THREE.DirectionalLight(0xfff7ed, 2.35);
    this.keyLight.position.set(1.35, 2.75, 1.25);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.25;
    this.keyLight.shadow.camera.far = 8.0;
    const d = 1.45;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.00025;
    this.keyLight.shadow.normalBias = 0.0055;
    this.scene.add(this.keyLight);

    // Overhead Linear Studio LED Softbox
    this.overheadSoftbox = new THREE.RectAreaLight(0xfffbf5, 4.4, 1.15, 0.34);
    this.overheadSoftbox.position.set(0, 1.38, 0.22);
    this.overheadSoftbox.lookAt(0, 0, 0.18);
    this.scene.add(this.overheadSoftbox);

    // Cool Window Fill Softbox from the right side of the lab
    this.windowFill = new THREE.RectAreaLight(0xe0f2fe, 2.8, 1.6, 0.9);
    this.windowFill.position.set(1.95, 0.85, 0.35);
    this.windowFill.lookAt(0, 0.15, 0.18);
    this.scene.add(this.windowFill);
  }

  _setupSharedMaterials() {
    this.plaMap = makeCarbonPLAMap();
    this.aluMap = makeBrushedAluminumMap();
    this.vslotMap = make2020VSlotMap();
    this._floorDayTex = makeConcreteFloorMap("studio");
    this._floorNightTex = makeConcreteFloorMap("night");

    this.matCarbonPLA = new THREE.MeshPhysicalMaterial({
      color: 0x262c36,
      map: this.plaMap,
      bumpMap: this.plaMap,
      bumpScale: 0.0014,
      roughness: 0.40,
      metalness: 0.10,
      clearcoat: 0.26,
      clearcoatRoughness: 0.42,
    });

    this.matOrangePLA = new THREE.MeshPhysicalMaterial({
      color: 0xea580c,
      bumpMap: this.plaMap,
      bumpScale: 0.0012,
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 0.42,
      clearcoatRoughness: 0.28,
    });

    this.matAluminum = new THREE.MeshPhysicalMaterial({
      color: 0xdce3ec,
      map: this.aluMap,
      roughness: 0.20,
      metalness: 0.94,
      clearcoat: 0.15,
    });

    this.matVSlot = new THREE.MeshPhysicalMaterial({
      color: 0xd5dee8,
      map: this.vslotMap,
      roughness: 0.26,
      metalness: 0.90,
    });

    this.matDarkAnodized = new THREE.MeshStandardMaterial({
      color: 0x1d232d,
      roughness: 0.30,
      metalness: 0.78,
    });

    this.matServoBody = new THREE.MeshStandardMaterial({
      color: 0x171c24,
      roughness: 0.46,
      metalness: 0.16,
    });

    this.matServoAnodized = new THREE.MeshPhysicalMaterial({
      color: 0xa61c1c,
      roughness: 0.22,
      metalness: 0.88,
      clearcoat: 0.28,
    });

    this.matBrass = new THREE.MeshStandardMaterial({
      color: 0xd9ab4c,
      roughness: 0.24,
      metalness: 0.94,
    });

    this.matBolt = new THREE.MeshStandardMaterial({
      color: 0xe8edf4,
      roughness: 0.18,
      metalness: 0.96,
    });

    this.matSilicone = new THREE.MeshStandardMaterial({
      color: 0x11151c,
      roughness: 0.92,
      metalness: 0.02,
    });
  }

  _buildLabRoom() {
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    // Real-Time Planar Floor Mirror Reflector beneath semi-transparent polished concrete
    this.floorReflector = new Reflector(new THREE.PlaneGeometry(6.0, 6.0), {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      color: 0x9aa4b2,
    });
    this.floorReflector.rotation.x = -Math.PI / 2;
    this.floorReflector.position.y = -TABLE_HEIGHT - 0.0015;
    this.roomGroup.add(this.floorReflector);

    this.floorOverlayMat = new THREE.MeshPhysicalMaterial({
      map: this._floorDayTex,
      roughness: 0.34,
      metalness: 0.06,
      transparent: true,
      opacity: 0.84,
      clearcoat: 0.32,
      clearcoatRoughness: 0.34,
    });
    this.floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), this.floorOverlayMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = -TABLE_HEIGHT;
    this.floorMesh.receiveShadow = true;
    this.roomGroup.add(this.floorMesh);

    // Clean Modern University Robotics Lab Back Wall + Acoustic Oak Slats + Technical Whiteboard
    this.backWallMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.86, metalness: 0.02 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 0.06), this.backWallMat);
    backWall.position.set(0, -TABLE_HEIGHT + 1.3, -2.14);
    backWall.receiveShadow = true;
    this.roomGroup.add(backWall);

    const slatMat = new THREE.MeshStandardMaterial({ color: 0x8b6747, roughness: 0.65, metalness: 0.04 });
    for (let sx = -2.1; sx <= 2.1; sx += 0.13) {
      if (Math.abs(sx) < 0.96) continue;
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.45, 0.028), slatMat);
      slat.position.set(sx, -TABLE_HEIGHT + 1.24, -2.095);
      slat.receiveShadow = true;
      this.roomGroup.add(slat);
    }

    const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.94, 0.032), this.matAluminum);
    boardFrame.position.set(0, 0.62, -2.09);
    this.roomGroup.add(boardFrame);
    const boardFace = new THREE.Mesh(
      new THREE.PlaneGeometry(1.70, 0.86),
      new THREE.MeshStandardMaterial({ map: makeLabWhiteboardMap(), roughness: 0.28 })
    );
    boardFace.position.set(0, 0.62, -2.072);
    this.roomGroup.add(boardFace);

    // Subtle Architectural Glass Side Lab Partitions
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      roughness: 0.14,
      metalness: 0.08,
      transparent: true,
      opacity: 0.10,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const gw = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.5), glassMat);
      gw.position.set(side * 2.1, -TABLE_HEIGHT + 1.25, 0);
      gw.rotation.y = (-side * Math.PI) / 2;
      this.roomGroup.add(gw);
      for (const my of [-TABLE_HEIGHT + 0.035, -TABLE_HEIGHT + 2.48]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.055, 4.2), this.matDarkAnodized);
        mullion.position.set(side * 2.1, my, 0);
        this.roomGroup.add(mullion);
      }
    }

    // Overhead Linear LED Light Fixture
    const fixtureHousing = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.045, 0.22), this.matDarkAnodized);
    fixtureHousing.position.set(0, 1.41, 0.22);
    this.roomGroup.add(fixtureHousing);
    const fixtureDiffuser = new THREE.Mesh(
      new THREE.PlaneGeometry(1.12, 0.18),
      new THREE.MeshBasicMaterial({ color: 0xfffaf0 })
    );
    fixtureDiffuser.rotation.x = Math.PI / 2;
    fixtureDiffuser.position.set(0, 1.386, 0.22);
    this.roomGroup.add(fixtureDiffuser);
  }

  _buildWorkbenchAndElectronics() {
    this.deskGroup = new THREE.Group();
    this.scene.add(this.deskGroup);

    // Butcher-Block Solid Oak Industrial Workbench Top (flush at Y = 0.000)
    const deskTop = new THREE.Mesh(
      new RoundedBoxGeometry(1.06, 0.044, 0.78, 4, 0.006),
      new THREE.MeshPhysicalMaterial({
        map: makeOakButcherBlockMap(),
        roughness: 0.44,
        metalness: 0.02,
        clearcoat: 0.28,
        clearcoatRoughness: 0.42,
      })
    );
    deskTop.position.set(0, -0.022, 0.15);
    deskTop.receiveShadow = true;
    deskTop.castShadow = true;
    this.deskGroup.add(deskTop);

    const deskTrim = new THREE.Mesh(new THREE.BoxGeometry(1.064, 0.011, 0.008), this.matAluminum);
    deskTrim.position.set(0, -0.018, 0.542);
    this.deskGroup.add(deskTrim);

    // Matte Anti-Static ESD Mat sitting flush on desk
    const esdMat = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 0.0022, 0.56),
      new THREE.MeshStandardMaterial({ map: makeESDMatMap(), roughness: 0.76, metalness: 0.04 })
    );
    esdMat.position.set(0, 0.0006, 0.18);
    esdMat.receiveShadow = true;
    this.deskGroup.add(esdMat);

    // Heavy Powder-Coated Steel Table Legs + Lower Brace
    const legGeo = new THREE.BoxGeometry(0.044, TABLE_HEIGHT - 0.044, 0.044);
    for (const [lx, lz] of [[-0.47, -0.18], [0.47, -0.18], [-0.47, 0.48], [0.47, 0.48]]) {
      const leg = new THREE.Mesh(legGeo, this.matDarkAnodized);
      leg.position.set(lx, -TABLE_HEIGHT / 2 - 0.022, lz);
      leg.castShadow = true;
      leg.receiveShadow = true;
      this.deskGroup.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.014, 16), this.matSilicone);
      foot.position.set(lx, -TABLE_HEIGHT + 0.007, lz);
      this.deskGroup.add(foot);
    }
    const backBrace = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, 0.03), this.matDarkAnodized);
    backBrace.position.set(0, -TABLE_HEIGHT + 0.18, -0.18);
    this.deskGroup.add(backBrace);

    // --- 1) Live 7-Segment Digital Bench Power Supply (6.0V 8A UBEC) ---
    this._psuCanvas = document.createElement("canvas");
    this._psuCanvas.width = 256; this._psuCanvas.height = 128;
    this._psuCtx = this._psuCanvas.getContext("2d");
    this._psuTex = new THREE.CanvasTexture(this._psuCanvas);
    this._psuTex.colorSpace = THREE.SRGBColorSpace;
    this.updatePSUScreen(6.0, 0.82, 4.9);

    const psuGroup = new THREE.Group();
    psuGroup.position.set(-0.37, 0.052, -0.09);
    psuGroup.rotation.y = 0.28;
    this.deskGroup.add(psuGroup);

    const psuBody = new THREE.Mesh(new RoundedBoxGeometry(0.145, 0.104, 0.155, 3, 0.006), this.matDarkAnodized);
    psuBody.castShadow = true;
    psuBody.receiveShadow = true;
    psuGroup.add(psuBody);
    const psuScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.112, 0.056),
      new THREE.MeshBasicMaterial({ map: this._psuTex })
    );
    psuScreen.position.set(0, 0.014, 0.0785);
    psuGroup.add(psuScreen);
    for (const [bx, col] of [[-0.032, 0xdc2626], [0.002, 0x111827]]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.014, 14),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })
      );
      post.rotation.x = Math.PI / 2;
      post.position.set(bx, -0.032, 0.082);
      psuGroup.add(post);
    }

    // --- 2) ESP32 DevKit + PCA9685 + 1000uF Cap + Braided Color-Coded Servo Wires ---
    const elecTray = new THREE.Group();
    elecTray.position.set(-0.22, 0.004, -0.06);
    this.deskGroup.add(elecTray);

    const trayPlate = new THREE.Mesh(
      new RoundedBoxGeometry(0.15, 0.005, 0.095, 2, 0.002),
      new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.22, clearcoat: 0.7 })
    );
    trayPlate.castShadow = true;
    elecTray.add(trayPlate);

    const espPcb = new THREE.Mesh(
      new THREE.BoxGeometry(0.054, 0.003, 0.028),
      new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.5 })
    );
    espPcb.position.set(-0.036, 0.005, -0.018);
    elecTray.add(espPcb);
    const espCan = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.004, 0.016), this.matAluminum);
    espCan.position.set(-0.048, 0.008, -0.018);
    elecTray.add(espCan);
    this.espLedMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.2 });
    const espLed = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.002), this.espLedMat);
    espLed.position.set(-0.016, 0.008, -0.015);
    elecTray.add(espLed);

    const pcaPcb = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.003, 0.026),
      new THREE.MeshStandardMaterial({ color: 0x0b4f8c, roughness: 0.40 })
    );
    pcaPcb.position.set(0.034, 0.005, -0.012);
    elecTray.add(pcaPcb);
    const screwTerm = new THREE.Mesh(
      new THREE.BoxGeometry(0.011, 0.010, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.5 })
    );
    screwTerm.position.set(0.006, 0.010, -0.012);
    elecTray.add(screwTerm);
    const capBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.016, 18),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.28, metalness: 0.3 })
    );
    capBody.position.set(0.020, 0.014, -0.012);
    elecTray.add(capBody);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0053, 0.0053, 0.001, 18), this.matAluminum);
    capTop.position.set(0.020, 0.0225, -0.012);
    elecTray.add(capTop);

    // 3-wire (Red 6V / Brown GND / Orange PWM) ribbon going from PCA9685 into arm base
    const wireColors = [0xdc2626, 0x451a03, 0xea580c];
    wireColors.forEach((hex, idx) => {
      const zOff = (idx - 1) * 0.0035;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.155, 0.012, -0.062 + zOff),
        new THREE.Vector3(-0.112, 0.017, -0.048 + zOff),
        new THREE.Vector3(-0.072, 0.013, -0.012 + zOff),
      ]);
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 18, 0.0016, 6, false),
        new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55 })
      );
      wire.castShadow = true;
      this.deskGroup.add(wire);
    });

    // --- 3) Industrial Yellow & Red Mushroom E-Stop Button ---
    const estopGroup = new THREE.Group();
    estopGroup.position.set(-0.43, 0.022, 0.36);
    this.deskGroup.add(estopGroup);
    const estopBox = new THREE.Mesh(
      new RoundedBoxGeometry(0.066, 0.044, 0.066, 3, 0.005),
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.42 })
    );
    estopBox.castShadow = true;
    estopGroup.add(estopBox);
    const estopStem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.014, 16), this.matDarkAnodized);
    estopStem.position.y = 0.026;
    estopGroup.add(estopStem);
    const estopCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.019, 0.016, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xdc2626, roughness: 0.24, clearcoat: 0.65 })
    );
    estopCap.position.y = 0.036;
    estopCap.castShadow = true;
    estopGroup.add(estopCap);

    // --- 4) 2020 V-Slot Aluminum Camera Gantry + AI-Thinker ESP32-CAM ---
    const gantry = new THREE.Group();
    this.deskGroup.add(gantry);
    const postGeo = new THREE.BoxGeometry(0.022, 0.54, 0.022);
    for (const gx of [-0.36, 0.36]) {
      const post = new THREE.Mesh(postGeo, this.matVSlot);
      post.position.set(gx, 0.27, 0.22);
      post.castShadow = true;
      gantry.add(post);
      const flange = new THREE.Mesh(new RoundedBoxGeometry(0.054, 0.008, 0.054, 2, 0.002), this.matDarkAnodized);
      flange.position.set(gx, 0.004, 0.22);
      gantry.add(flange);
      const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.024), this.matAluminum);
      gusset.position.set(gx - Math.sign(gx) * 0.022, 0.522, 0.22);
      gantry.add(gusset);
    }
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.022, 0.022), this.matVSlot);
    crossBar.position.set(0, 0.545, 0.22);
    crossBar.castShadow = true;
    gantry.add(crossBar);

    const camMount = new THREE.Group();
    camMount.position.set(0, 0.524, 0.22);
    gantry.add(camMount);
    const camCase = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.018, 0.034, 2, 0.003), this.matCarbonPLA);
    camCase.castShadow = true;
    camMount.add(camCase);
    const camBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0085, 0.011, 24), this.matDarkAnodized);
    camBarrel.position.y = -0.011;
    camMount.add(camBarrel);
    const camGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 20),
      new THREE.MeshPhysicalMaterial({ color: 0x091628, roughness: 0.04, metalness: 0.2, clearcoat: 1.0 })
    );
    camGlass.position.y = -0.0165;
    camMount.add(camGlass);
    const camRingLed = new THREE.Mesh(
      new THREE.TorusGeometry(0.014, 0.0022, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xfff6e5 })
    );
    camRingLed.rotation.x = Math.PI / 2;
    camRingLed.position.y = -0.0095;
    camMount.add(camRingLed);

    const camConeGeo = new THREE.ConeGeometry(0.31, 0.51, 4, 1, true);
    camConeGeo.rotateY(Math.PI / 4);
    this.camCone = new THREE.Mesh(
      camConeGeo,
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.camCone.position.set(0, 0.26, 0.22);
    gantry.add(this.camCone);

    // 4 Sorting Zone Anodized Pads
    for (const prof of Object.values(COLOR_PROFILES)) {
      const col = new THREE.Color(prof.hex);
      const pad = new THREE.Mesh(
        new RoundedBoxGeometry(0.074, 0.003, 0.074, 2, 0.001),
        new THREE.MeshPhysicalMaterial({
          color: 0x151b24,
          roughness: 0.45,
          metalness: 0.22,
          emissive: col,
          emissiveIntensity: 0.14,
        })
      );
      pad.position.set(prof.zonePos[0], 0.0024, prof.zonePos[2]);
      pad.receiveShadow = true;
      this.deskGroup.add(pad);
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.075, 0.0035, 0.075)),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.8 })
      );
      rim.position.copy(pad.position);
      this.deskGroup.add(rim);
    }
  }

  _createDS3218Servo(scale = 1.0) {
    const g = new THREE.Group();
    const bot = new THREE.Mesh(new RoundedBoxGeometry(0.040 * scale, 0.011 * scale, 0.020 * scale, 2, 0.0015), this.matServoBody);
    bot.position.y = -0.014 * scale;
    g.add(bot);
    const mid = new THREE.Mesh(new RoundedBoxGeometry(0.0405 * scale, 0.018 * scale, 0.0205 * scale, 2, 0.0015), this.matServoAnodized);
    mid.castShadow = true;
    g.add(mid);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.040 * scale, 0.010 * scale, 0.020 * scale, 2, 0.0015), this.matServoBody);
    top.position.y = 0.013 * scale;
    g.add(top);
    const ears = new THREE.Mesh(new THREE.BoxGeometry(0.054 * scale, 0.0025 * scale, 0.020 * scale), this.matServoBody);
    ears.position.y = 0.009 * scale;
    g.add(ears);
    const spline = new THREE.Mesh(new THREE.CylinderGeometry(0.003 * scale, 0.003 * scale, 0.007 * scale, 14), this.matBrass);
    spline.position.set(0.010 * scale, 0.021 * scale, 0);
    g.add(spline);
    return g;
  }

  _createServoHornDisc(radius = 0.016) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.0045, 28), this.matAluminum);
    disc.castShadow = true;
    g.add(disc);
    const cBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.006, 6), this.matBolt);
    g.add(cBolt);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0055, 8), this.matBolt);
      sc.position.set(Math.cos(a) * radius * 0.65, 0, Math.sin(a) * radius * 0.65);
      g.add(sc);
    }
    return g;
  }

  _makeSpurGear(radius = 0.0105, teeth = 12) {
    const g = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, 0.005, 20), this.matBrass);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0042, 0.0048), this.matBrass);
      t.position.set(Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92, 0);
      t.rotation.z = a + Math.PI / 2;
      g.add(t);
    }
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.007, 8), this.matBolt);
    screw.rotation.x = Math.PI / 2;
    g.add(screw);
    return g;
  }

  _buildRobotArm() {
    this.robotRoot = new THREE.Group();
    this.scene.add(this.robotRoot);

    const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 0.013, 44), this.matDarkAnodized);
    basePlate.position.y = 0.007;
    basePlate.castShadow = true;
    basePlate.receiveShadow = true;
    this.robotRoot.add(basePlate);

    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.005, 6), this.matBolt);
      bolt.position.set(Math.cos(a) * 0.065, 0.015, Math.sin(a) * 0.065);
      this.robotRoot.add(bolt);
    }

    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.058, 0.0018, 12, 56),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 1.4 })
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.015;
    this.robotRoot.add(baseRing);

    const baseHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.056, 0.036, 36), this.matCarbonPLA);
    baseHousing.position.y = 0.032;
    baseHousing.castShadow = true;
    this.robotRoot.add(baseHousing);

    // J1 Turntable
    this.j1Group = new THREE.Group();
    this.j1Group.position.set(0, 0.050, 0);
    this.robotRoot.add(this.j1Group);

    const bearingRace = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.049, 0.009, 36), this.matAluminum);
    bearingRace.position.y = 0.0045;
    bearingRace.castShadow = true;
    this.j1Group.add(bearingRace);

    const turretBase = new THREE.Mesh(new RoundedBoxGeometry(0.072, 0.014, 0.058, 3, 0.003), this.matCarbonPLA);
    turretBase.position.y = 0.014;
    turretBase.castShadow = true;
    this.j1Group.add(turretBase);

    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new RoundedBoxGeometry(0.011, 0.050, 0.044, 3, 0.003), this.matCarbonPLA);
      cheek.position.set(side * 0.031, 0.036, 0);
      cheek.castShadow = true;
      this.j1Group.add(cheek);
    }
    const shServo = this._createDS3218Servo(1.0);
    shServo.rotation.z = Math.PI / 2;
    shServo.position.set(0.006, 0.045, -0.010);
    this.j1Group.add(shServo);

    // J2 Shoulder (EXACT World Y = L0 = 0.095m)
    this.j2Group = new THREE.Group();
    this.j2Group.position.set(0, L0_BASE_HEIGHT - 0.050, 0);
    this.j1Group.add(this.j2Group);

    const shShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.078, 24), this.matDarkAnodized);
    shShaft.rotation.z = Math.PI / 2;
    this.j2Group.add(shShaft);
    for (const side of [-1, 1]) {
      const horn = this._createServoHornDisc(0.017);
      horn.rotation.z = (side * Math.PI) / 2;
      horn.position.x = side * 0.039;
      this.j2Group.add(horn);
    }

    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new RoundedBoxGeometry(0.010, L1_UPPER_ARM + 0.018, 0.034, 3, 0.003), this.matCarbonPLA);
      beam.position.set(side * 0.023, L1_UPPER_ARM * 0.5, 0);
      beam.castShadow = true;
      beam.receiveShadow = true;
      this.j2Group.add(beam);
      const rib = new THREE.Mesh(new RoundedBoxGeometry(0.0115, L1_UPPER_ARM * 0.54, 0.009, 2, 0.002), this.matOrangePLA);
      rib.position.set(side * 0.023, L1_UPPER_ARM * 0.5, 0);
      this.j2Group.add(rib);
    }
    for (const frac of [0.26, 0.52, 0.78]) {
      const spacer = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.044, 14), this.matAluminum);
      spacer.rotation.z = Math.PI / 2;
      spacer.position.set(0, L1_UPPER_ARM * frac, 0);
      this.j2Group.add(spacer);
    }

    // J3 Elbow
    this.j3Group = new THREE.Group();
    this.j3Group.position.set(0, L1_UPPER_ARM, 0);
    this.j2Group.add(this.j3Group);

    const elServo = this._createDS3218Servo(0.92);
    elServo.rotation.z = Math.PI / 2;
    elServo.position.set(0.004, 0.002, -0.009);
    this.j3Group.add(elServo);
    for (const side of [-1, 1]) {
      const horn = this._createServoHornDisc(0.015);
      horn.rotation.z = (side * Math.PI) / 2;
      horn.position.x = side * 0.032;
      this.j3Group.add(horn);
    }

    const forearm = new THREE.Mesh(new RoundedBoxGeometry(0.030, L2_FOREARM - 0.006, 0.028, 3, 0.004), this.matCarbonPLA);
    forearm.position.set(0, L2_FOREARM * 0.5, 0);
    forearm.castShadow = true;
    forearm.receiveShadow = true;
    this.j3Group.add(forearm);
    const forearmTrim = new THREE.Mesh(new RoundedBoxGeometry(0.032, L2_FOREARM * 0.48, 0.008, 2, 0.002), this.matOrangePLA);
    forearmTrim.position.set(0, L2_FOREARM * 0.52, 0);
    this.j3Group.add(forearmTrim);

    // J4 Wrist Pitch
    this.j4Group = new THREE.Group();
    this.j4Group.position.set(0, L2_FOREARM, 0);
    this.j3Group.add(this.j4Group);

    const wrServo = this._createDS3218Servo(0.72);
    wrServo.rotation.z = Math.PI / 2;
    wrServo.position.set(0, 0.004, -0.004);
    this.j4Group.add(wrServo);
    for (const side of [-1, 1]) {
      const horn = this._createServoHornDisc(0.011);
      horn.rotation.z = (side * Math.PI) / 2;
      horn.position.x = side * 0.022;
      this.j4Group.add(horn);
    }
    const wrCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.030, 24), this.matCarbonPLA);
    wrCollar.position.y = 0.018;
    wrCollar.castShadow = true;
    this.j4Group.add(wrCollar);

    // J5 Wrist Roll + Spur-Gear Parallel Gripper
    this.j5Group = new THREE.Group();
    this.j5Group.position.set(0, 0.034, 0);
    this.j4Group.add(this.j5Group);

    const rollFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 24), this.matAluminum);
    rollFlange.position.y = 0.003;
    this.j5Group.add(rollFlange);

    const gripperBody = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.022, 0.024, 3, 0.003), this.matCarbonPLA);
    gripperBody.position.y = 0.016;
    gripperBody.castShadow = true;
    this.j5Group.add(gripperBody);

    const gripServo = new THREE.Mesh(new RoundedBoxGeometry(0.023, 0.022, 0.013, 2, 0.0015), this.matServoBody);
    gripServo.position.set(0.012, 0.016, -0.016);
    this.j5Group.add(gripServo);

    this.gearLeft = this._makeSpurGear();
    this.gearLeft.position.set(-0.0108, 0.022, 0.013);
    this.gearRight = this._makeSpurGear();
    this.gearRight.position.set(0.0108, 0.022, 0.013);
    this.gearRight.rotation.z = Math.PI / 12;
    this.j5Group.add(this.gearLeft, this.gearRight);

    this.fingerLeft = new THREE.Group();
    this.fingerRight = new THREE.Group();
    this.j5Group.add(this.fingerLeft, this.fingerRight);
    const buildJaw = (parent, sign) => {
      const f = new THREE.Mesh(new RoundedBoxGeometry(0.007, 0.050, 0.015, 2, 0.0018), this.matAluminum);
      f.position.set(sign * 0.0065, 0.044, 0);
      f.castShadow = true;
      parent.add(f);
      const p = new THREE.Mesh(new RoundedBoxGeometry(0.003, 0.028, 0.018, 2, 0.0008), this.matSilicone);
      p.position.set(sign * 0.0015, 0.056, 0);
      parent.add(p);
    };
    buildJaw(this.fingerLeft, -1);
    buildJaw(this.fingerRight, 1);

    this._loomMat = new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.72, metalness: 0.12 });
    this._armLoomMesh = null;
  }

  _buildWiFiCSI() {
    this.csiNodesGroup = new THREE.Group();
    this.csiLinksGroup = new THREE.Group();
    this.csiWaveGroup = new THREE.Group();
    this.roomGroup.add(this.csiNodesGroup, this.csiLinksGroup, this.csiWaveGroup);

    this._csiBuilt = false;
    this._fresnelEntries = new Map();

    // Smooth continuous GLSL RF wave floor shader (zero blocky tiles!)
    this._waveTexData = new Uint8Array(16 * 16 * 4);
    this._waveDataTex = new THREE.DataTexture(this._waveTexData, 16, 16, THREE.RGBAFormat);
    this._waveDataTex.magFilter = THREE.LinearFilter;
    this._waveDataTex.minFilter = THREE.LinearFilter;

    this.rfFloorShader = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uTxPos: { value: new THREE.Vector2(-1.75, -1.55) },
        uOpPos: { value: new THREE.Vector2(0.42, 1.24) },
        uMotion: { value: 0.2 },
        uWaveTex: { value: this._waveDataTex },
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
          float edgeFade = smoothstep(2.12, 1.45, max(abs(p.x), abs(p.y)));
          float dTx = length(p - uTxPos);
          float carrier = pow(0.5 + 0.5 * sin(dTx * 11.5 - uTime * 5.2), 4.0);
          float txFalloff = exp(-dTx * 0.45);
          float dOp = length(p - uOpPos);
          float opHalo = exp(-dOp * dOp * 2.4);
          float opRing = pow(0.5 + 0.5 * sin(dOp * 16.0 - uTime * 6.5), 5.0) * exp(-dOp * 1.2);
          float fieldVal = texture2D(uWaveTex, vUv).r;
          vec3 colCyan = vec3(0.02, 0.62, 0.88);
          vec3 colAmber = vec3(0.92, 0.48, 0.14);
          vec3 color = colCyan * (carrier * txFalloff * 0.65 + fieldVal * 0.25 + opRing * 0.85);
          color += mix(colCyan, colAmber, clamp(uMotion * 1.2, 0.0, 1.0)) * opHalo * 0.65;
          float alpha = clamp((carrier * txFalloff * 0.28 + opRing * 0.42 + opHalo * 0.35 + fieldVal * 0.14) * edgeFade, 0.0, 0.62);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    const rfPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), this.rfFloorShader);
    rfPlane.rotation.x = -Math.PI / 2;
    rfPlane.position.y = -TABLE_HEIGHT + 0.005;
    this.csiWaveGroup.add(rfPlane);

    // Sculpted Volumetric Fresnel Human Operator (CMU DensePose / RuView Spatial AR Look)
    this.operatorGroup = new THREE.Group();
    this.roomGroup.add(this.operatorGroup);

    this.holoOpShader = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uEnergy: { value: 0.25 } },
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
          float fresnel = pow(1.0 - ndv, 2.2);
          float scan = pow(0.5 + 0.5 * sin(vWorldPos.y * 26.0 - uTime * 3.8), 6.0);
          vec3 coreCol = vec3(0.04, 0.24, 0.44);
          vec3 rimCol = mix(vec3(0.05, 0.78, 0.96), vec3(0.55, 0.34, 0.95), clamp(uEnergy * 0.9, 0.0, 1.0));
          vec3 col = mix(coreCol, rimCol, fresnel) + rimCol * scan * 0.28;
          float alpha = clamp(0.18 + fresnel * 0.72 + scan * 0.12, 0.0, 0.88);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const opRoot = new THREE.Group();
    opRoot.position.y = -TABLE_HEIGHT;
    this.operatorGroup.add(opRoot);

    const torsoPts = [
      new THREE.Vector2(0.0, 0.82), new THREE.Vector2(0.14, 0.84),
      new THREE.Vector2(0.13, 0.98), new THREE.Vector2(0.155, 1.18),
      new THREE.Vector2(0.185, 1.36), new THREE.Vector2(0.085, 1.44),
      new THREE.Vector2(0.058, 1.48), new THREE.Vector2(0.0, 1.49),
    ];
    this.opTorso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 32), this.holoOpShader);
    this.opTorso.scale.set(1.05, 1.0, 0.68);
    opRoot.add(this.opTorso);

    const opHead = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 24), this.holoOpShader);
    opHead.scale.set(0.92, 1.14, 1.0);
    opHead.position.set(0, 1.60, 0.01);
    opRoot.add(opHead);

    const makeLimb = (x, y, len, rTop, rBot) => {
      const p = new THREE.Group();
      p.position.set(x, y, 0);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry((rTop + rBot) * 0.5, len, 12, 20), this.holoOpShader);
      seg.position.y = -len * 0.5 - rTop * 0.5;
      p.add(seg);
      return p;
    };
    this.opArmL = makeLimb(-0.22, 1.35, 0.48, 0.048, 0.036);
    this.opArmR = makeLimb(0.22, 1.35, 0.48, 0.048, 0.036);
    this.opLegL = makeLimb(-0.095, 0.84, 0.72, 0.068, 0.048);
    this.opLegR = makeLimb(0.095, 0.84, 0.72, 0.068, 0.048);
    opRoot.add(this.opArmL, this.opArmR, this.opLegL, this.opLegR);

    const pcPos = new Float32Array(320 * 3);
    for (let i = 0; i < 320; i++) {
      const h = 0.25 + Math.random() * 1.45;
      const a = Math.random() * Math.PI * 2;
      const r = (h > 1.45 ? 0.12 : h > 0.85 ? 0.21 : 0.16) * (0.85 + Math.random() * 0.35);
      pcPos[i * 3] = Math.cos(a) * r;
      pcPos[i * 3 + 1] = h;
      pcPos[i * 3 + 2] = Math.sin(a) * r * 0.78;
    }
    const pcGeo = new THREE.BufferGeometry();
    pcGeo.setAttribute("position", new THREE.BufferAttribute(pcPos, 3));
    this.opPoints = new THREE.Points(
      pcGeo,
      new THREE.PointsMaterial({ color: 0x0ea5e9, size: 0.016, transparent: true, opacity: 0.72, depthWrite: false })
    );
    opRoot.add(this.opPoints);

    this.opHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.27, 0.295, 56),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, side: THREE.DoubleSide, transparent: true, opacity: 0.78, depthWrite: false })
    );
    this.opHalo.rotation.x = -Math.PI / 2;
    this.opHalo.position.y = 0.012;
    opRoot.add(this.opHalo);
  }

  _ensureCSINodes(nodes) {
    if (this._csiBuilt) return;
    this._csiBuilt = true;
    const tx = nodes.find((n) => n.role === "TX_ROUTER");

    for (const n of nodes) {
      const isTx = n.role === "TX_ROUTER";
      const g = new THREE.Group();
      g.position.set(n.pos[0], -TABLE_HEIGHT + n.pos[1], n.pos[2]);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.014, n.pos[1], 16), this.matDarkAnodized);
      pole.position.y = -n.pos[1] * 0.5;
      g.add(pole);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.014, 24), this.matDarkAnodized);
      foot.position.y = -n.pos[1] + 0.007;
      g.add(foot);
      const box = new THREE.Mesh(
        new RoundedBoxGeometry(isTx ? 0.18 : 0.078, isTx ? 0.032 : 0.022, isTx ? 0.12 : 0.048, 2, 0.004),
        isTx ? this.matDarkAnodized : new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 })
      );
      g.add(box);
      for (const ax of isTx ? [-0.065, 0, 0.065] : [0]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0048, 0.15, 12), this.matDarkAnodized);
        ant.position.set(ax, 0.075, -0.02);
        g.add(ant);
      }
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 12, 12),
        new THREE.MeshBasicMaterial({ color: isTx ? 0xf59e0b : 0x0ea5e9 })
      );
      led.position.set(0, 0.018, 0.025);
      g.add(led);
      this.csiNodesGroup.add(g);

      if (!isTx && tx) {
        const p0 = new THREE.Vector3(tx.pos[0], -TABLE_HEIGHT + tx.pos[1], tx.pos[2]);
        const p1 = new THREE.Vector3(n.pos[0], -TABLE_HEIGHT + n.pos[1], n.pos[2]);
        const dist = p0.distanceTo(p1);
        const mid = p0.clone().lerp(p1, 0.5);
        const r1 = Math.sqrt(0.123 * dist * 0.25);

        const ellip = new THREE.Mesh(
          new THREE.SphereGeometry(1.0, 20, 10),
          new THREE.MeshBasicMaterial({
            color: 0x0284c7,
            transparent: true,
            opacity: 0.045,
            wireframe: true,
            depthWrite: false,
          })
        );
        ellip.position.copy(mid);
        ellip.lookAt(p1);
        ellip.scale.set(r1 * 0.34, r1 * 0.34, dist * 0.5);
        this.csiLinksGroup.add(ellip);

        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([p0, p1]),
          new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.42 })
        );
        this.csiLinksGroup.add(line);

        const pulse = new THREE.Mesh(
          new THREE.SphereGeometry(0.016, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        this.csiLinksGroup.add(pulse);

        this._fresnelEntries.set(n.id, { ellip, line, pulse, p0, p1 });
      }
    }
  }

  _setupVirtualOV2640Camera() {
    this.virtualCam = new THREE.PerspectiveCamera(CAM_FOV_V_DEG, CAM_W / CAM_H, 0.05, 2.0);
    this.virtualCam.position.set(...CAM_POS);
    this.virtualCam.up.set(0, 0, -1);
    this.virtualCam.lookAt(CAM_POS[0], 0.0, CAM_POS[2]);

    this._vCamRT = new THREE.WebGLRenderTarget(CAM_W, CAM_H);
    this._vCamPixels = new Uint8Array(CAM_W * CAM_H * 4);
    this._vCamImgData = new ImageData(CAM_W, CAM_H);
  }

  captureVirtualOV2640ImageData() {
    // Temporarily hide non-optical digital overlays so virtual camera sees pure physical reality
    const pCone = this.camCone.visible;
    const pWave = this.csiWaveGroup.visible;
    const pLinks = this.csiLinksGroup.visible;
    this.camCone.visible = false;
    this.csiWaveGroup.visible = false;
    this.csiLinksGroup.visible = false;

    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._vCamRT);
    this.renderer.render(this.scene, this.virtualCam);
    this.renderer.readRenderTargetPixels(this._vCamRT, 0, 0, CAM_W, CAM_H, this._vCamPixels);
    this.renderer.setRenderTarget(prevRT);

    this.camCone.visible = pCone;
    this.csiWaveGroup.visible = pWave;
    this.csiLinksGroup.visible = pLinks;

    const dst = this._vCamImgData.data;
    const rowBytes = CAM_W * 4;
    for (let y = 0; y < CAM_H; y++) {
      dst.set(this._vCamPixels.subarray((CAM_H - 1 - y) * rowBytes, (CAM_H - y) * rowBytes), y * rowBytes);
    }
    return this._vCamImgData;
  }

  updatePSUScreen(v, a, w) {
    const ctx = this._psuCtx;
    ctx.fillStyle = "#080c12";
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.fillStyle = "#22d3ee";
    ctx.font = "bold 40px Consolas, monospace";
    ctx.fillText(`${v.toFixed(2)}V`, 18, 52);
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 36px Consolas, monospace";
    ctx.fillText(`${a.toFixed(2)}A`, 18, 98);
    ctx.fillStyle = "#4ade80";
    ctx.font = "bold 18px Consolas, monospace";
    ctx.fillText("CV", 198, 34);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px Consolas, monospace";
    ctx.fillText(`${w.toFixed(1)}W`, 178, 98);
    this._psuTex.needsUpdate = true;
  }

  setLightingTheme(theme) {
    this.lightingTheme = theme;
    const isDay = theme === "studio";
    this.scene.environment = isDay ? this._studioEnv : this._nightEnv;
    this.scene.environmentIntensity = isDay ? 0.92 : 0.78;
    const bgHex = isDay ? 0xcbd5e1 : 0x090e17;
    this.scene.background.setHex(bgHex);
    this.scene.fog.color.setHex(bgHex);
    this.scene.fog.density = isDay ? 0.044 : 0.062;
    this.hemiLight.intensity = isDay ? 0.72 : 0.38;
    this.keyLight.intensity = isDay ? 2.35 : 2.0;
    this.overheadSoftbox.intensity = isDay ? 4.4 : 3.6;
    this.windowFill.intensity = isDay ? 2.8 : 1.5;
    this.backWallMat.color.setHex(isDay ? 0xdbe2ea : 0x131924);
    this.floorOverlayMat.map = isDay ? this._floorDayTex : this._floorNightTex;
    this.floorOverlayMat.needsUpdate = true;
    this.bloomPass.strength = isDay ? 0.14 : 0.24;
  }

  setUltraQuality(enabled) {
    this.ultraQuality = enabled;
    this.gtaoPass.enabled = enabled;
    this.floorReflector.visible = enabled;
    this.floorOverlayMat.opacity = enabled ? 0.84 : 1.0;
  }

  loadCustomSTL(arrayBuffer) {
    const loader = new STLLoader();
    const geom = loader.parse(arrayBuffer);
    geom.computeVertexNormals();
    geom.center();
    const box = new THREE.Box3().setFromBufferAttribute(geom.attributes.position);
    const sz = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
    const scale = 0.085 / maxDim; // Normalize preview part nicely to 8.5 cm on the bench!
    if (this.customStlMesh) {
      this.deskGroup.remove(this.customStlMesh);
      this.customStlMesh.geometry.dispose();
    }
    this.customStlMesh = new THREE.Mesh(geom, this.matOrangePLA);
    this.customStlMesh.scale.setScalar(scale);
    this.customStlMesh.position.set(0.32, (sz.y * scale) * 0.5 + 0.002, -0.06);
    this.customStlMesh.castShadow = true;
    this.customStlMesh.receiveShadow = true;
    this.deskGroup.add(this.customStlMesh);
  }

  flyCamera(presetKey) {
    const presets = {
      close: { pos: new THREE.Vector3(0.46, 0.35, 0.50), target: new THREE.Vector3(0.0, 0.11, 0.16) },
      iso:   { pos: new THREE.Vector3(0.84, 0.64, 0.88), target: new THREE.Vector3(-0.04, 0.11, 0.14) },
      room:  { pos: new THREE.Vector3(2.42, 1.84, 2.70), target: new THREE.Vector3(0.0, -0.05, 0.18) },
      top:   { pos: new THREE.Vector3(0.0, 1.02, 0.23),  target: new THREE.Vector3(0.0, 0.0, 0.20) },
    };
    const p = presets[presetKey];
    if (!p) return;
    this._camAnim = {
      startPos: this.camera.position.clone(),
      endPos: p.pos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: p.target.clone(),
      t: 0,
    };
  }

  syncState(joints, fk, electrical, cubes, csi, elapsed, nowMs) {
    // 1. Robot 6-DOF Joints
    this.j1Group.rotation.y = THREE.MathUtils.degToRad(joints.j1_base);
    this.j2Group.rotation.x = THREE.MathUtils.degToRad(joints.j2_shoulder);
    this.j3Group.rotation.x = THREE.MathUtils.degToRad(joints.j3_elbow);
    this.j4Group.rotation.x = THREE.MathUtils.degToRad(joints.j4_wrist_pitch);
    this.j5Group.rotation.y = THREE.MathUtils.degToRad(joints.j5_wrist_roll);

    const gapM = gripperGapMm(joints.j6_gripper) / 1000;
    this.fingerLeft.position.x = -gapM * 0.5;
    this.fingerRight.position.x = gapM * 0.5;
    const gearRad = THREE.MathUtils.degToRad(joints.j6_gripper * 1.4);
    this.gearLeft.rotation.z = gearRad;
    this.gearRight.rotation.z = -gearRad + Math.PI / 12;

    // Update flexing cable loom
    const s = new THREE.Vector3(...fk.shoulder);
    const e = new THREE.Vector3(...fk.elbow);
    const w = new THREE.Vector3(...fk.wrist);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.045, -0.032),
      s.clone().add(new THREE.Vector3(0, 0.01, -0.028)),
      s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, 0.012, -0.022)),
      e.clone().add(new THREE.Vector3(0, 0.016, -0.024)),
      e.clone().lerp(w, 0.5).add(new THREE.Vector3(0, 0.018, -0.016)),
      w.clone().add(new THREE.Vector3(0, 0.008, -0.014)),
    ]);
    const loomGeo = new THREE.TubeGeometry(curve, 22, 0.0034, 7, false);
    if (!this._armLoomMesh) {
      this._armLoomMesh = new THREE.Mesh(loomGeo, this._loomMat);
      this._armLoomMesh.castShadow = true;
      this.scene.add(this._armLoomMesh);
    } else {
      this._armLoomMesh.geometry.dispose();
      this._armLoomMesh.geometry = loomGeo;
    }

    // 2. Cubes
    const seen = new Set();
    for (const c of cubes) {
      seen.add(c.id);
      let mesh = this.cubeMeshes.get(c.id);
      if (!mesh) {
        const geo = new RoundedBoxGeometry(c.sizeM, c.sizeM, c.sizeM, 4, 0.0024);
        const mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(c.hex),
          roughness: 0.26,
          metalness: 0.04,
          clearcoat: 0.62,
          clearcoatRoughness: 0.20,
          bumpMap: this.plaMap,
          bumpScale: 0.0005,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.cubeMeshes.set(c.id, mesh);
      }
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.rotation.y = THREE.MathUtils.degToRad(c.yawDeg);
      mesh.material.emissive.set(c.status === "IN_GRIPPER" ? c.hex : "#000000");
      mesh.material.emissiveIntensity = c.status === "IN_GRIPPER" ? 0.14 : 0.0;
    }
    for (const [id, mesh] of this.cubeMeshes.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.cubeMeshes.delete(id);
      }
    }

    // 3. Live 3D Lab PSU Display
    if (nowMs - this._lastPsuMs > 160) {
      this._lastPsuMs = nowMs;
      this.updatePSUScreen(electrical.busVoltageV, electrical.totalCurrentA, electrical.powerW);
    }
    this.espLedMat.emissiveIntensity = Math.sin(elapsed * 18) > 0.2 ? 2.6 : 0.25;

    // 4. Wi-Fi CSI 3D Operator, GLSL Wave Shader & Wireframe Fresnel Ellipsoids
    this._ensureCSINodes(csi.nodes);
    const op = csi.operator;
    this.operatorGroup.position.set(op.x, 0, op.z);
    this.operatorGroup.rotation.y = op.yaw;
    this.holoOpShader.uniforms.uTime.value = elapsed;
    this.holoOpShader.uniforms.uEnergy.value = op.motionEnergy;

    const breath = 1 + 0.032 * Math.sin(elapsed * (op.breathingBpm / 60) * Math.PI * 2);
    this.opTorso.scale.set(1.05 * breath, 1, 0.68 * breath);
    const swing = Math.sin(elapsed * 7.2) * Math.min(0.42, op.speed * 1.35);
    this.opLegL.rotation.x = swing;
    this.opLegR.rotation.x = -swing;
    this.opArmL.rotation.x = -swing * 0.65 - 0.18;
    this.opArmR.rotation.x = swing * 0.65 - 0.18;
    this.opHalo.scale.setScalar(1 + 0.08 * Math.sin(elapsed * 3.0));
    this.opPoints.rotation.y = elapsed * 0.25;

    this.rfFloorShader.uniforms.uTime.value = elapsed;
    this.rfFloorShader.uniforms.uOpPos.value.set(op.x, op.z);
    this.rfFloorShader.uniforms.uMotion.value = op.motionEnergy;
    for (let i = 0; i < 256; i++) {
      const v = Math.min(255, Math.floor(csi.waveField[i] * 255));
      this._waveTexData[i * 4] = v;
      this._waveTexData[i * 4 + 1] = v;
      this._waveTexData[i * 4 + 2] = v;
      this._waveTexData[i * 4 + 3] = 255;
    }
    this._waveDataTex.needsUpdate = true;

    let idx = 0;
    const camDist = this.camera.position.length();
    // Keep Fresnel wireframe super subtle when inspecting the workbench close-up; full prominence in Room view!
    const roomVisScale = THREE.MathUtils.clamp((camDist - 1.15) / 1.4, 0.14, 1.0);
    for (const n of csi.nodes) {
      const entry = this._fresnelEntries.get(n.id);
      if (!entry) continue;
      const d = n.fresnelDisturbance || 0;
      entry.ellip.material.color.setHSL(0.55 - d * 0.44, 0.9, 0.48);
      entry.ellip.material.opacity = (0.025 + d * 0.085) * roomVisScale;
      entry.line.material.color.setHSL(0.55 - d * 0.44, 0.9, 0.52);
      entry.line.material.opacity = (0.22 + d * 0.58) * roomVisScale;
      const u = (elapsed * 0.65 + idx * 0.33) % 1;
      entry.pulse.position.lerpVectors(entry.p0, entry.p1, u);
      entry.pulse.material.color.setHSL(0.55 - d * 0.44, 0.95, 0.62);
      entry.pulse.visible = roomVisScale > 0.25;
      idx++;
    }
  }

  renderFrame() {
    if (this._camAnim) {
      this._camAnim.t = Math.min(1, this._camAnim.t + 0.045);
      const s = this._camAnim.t * this._camAnim.t * (3 - 2 * this._camAnim.t);
      this.camera.position.lerpVectors(this._camAnim.startPos, this._camAnim.endPos, s);
      this.controls.target.lerpVectors(this._camAnim.startTarget, this._camAnim.endTarget, s);
      if (this._camAnim.t >= 1) this._camAnim = null;
    }
    this.controls.update();
    this.composer.render();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.gtaoPass.setSize(w, h);
  }
}
