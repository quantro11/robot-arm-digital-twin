import {
  ElectricalPhysicsModel,
  GRIPPER_CUBE_38MM_DEG,
  GRIPPER_OPEN_DEG,
  HOME_JOINTS,
  JOINT_LIMITS,
  SmoothTrajectory,
  clamp,
  forwardKinematics,
  inverseKinematics,
} from "./kinematics.js";
import { COLOR_PROFILES } from "./vision.js";

export class MissionController {
  constructor(onLog = () => {}) {
    this.mode = "auto_pick_place"; // "auto_pick_place" | "manual_joints"
    this.phase = "SCANNING";
    this.paused = false;
    this.speedMultiplier = 1.0;
    this.sortedCount = 0;
    this.cycleCount = 1;

    this.joints = { ...HOME_JOINTS };
    this.velocities = Object.fromEntries(Object.keys(JOINT_LIMITS).map((k) => [k, 0]));
    this.trajectory = new SmoothTrajectory();
    this.elecModel = new ElectricalPhysicsModel();
    this.electrical = this.elecModel.step(this.joints, this.velocities, 0, 0.016);

    this.cubes = [];
    this.activeCube = null;
    this.heldCube = null;
    this._phaseWait = 0.45;
    this._onLog = onLog;

    this._spawnBatch();
  }

  _spawnBatch() {
    const slots = [
      ["RED", -0.068, 0.262, 14],
      ["BLUE", 0.064, 0.256, -18],
      ["GREEN", -0.062, 0.192, 24],
      ["YELLOW", 0.066, 0.188, -11],
    ];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.cubes = slots.map(([colorKey, sx, sz, yaw], i) => {
      const prof = COLOR_PROFILES[colorKey];
      const sizeM = 0.038;
      return {
        id: `CUBE-${String(this.cycleCount).padStart(2, "0")}${i + 1}`,
        colorKey,
        colorTr: prof.labelTr,
        hex: prof.hex,
        targetZone: prof.zone,
        sizeM,
        pos: [
          Number((sx + (Math.random() - 0.5) * 0.014).toFixed(4)),
          sizeM * 0.5,
          Number((sz + (Math.random() - 0.5) * 0.014).toFixed(4)),
        ],
        yawDeg: Number((yaw + (Math.random() - 0.5) * 14).toFixed(1)),
        status: "WAITING",
      };
    });
    this.activeCube = null;
    this.heldCube = null;
    this.phase = "SCANNING";
    this._phaseWait = 0.45;
  }

  resetCubes() {
    this.cycleCount++;
    this._spawnBatch();
    this.trajectory.moveTo(this.joints, HOME_JOINTS, 0.72);
    this._onLog("MISSION", `Yeni küp grubu (Tur #${this.cycleCount}) çalışma masasına yerleştirildi.`);
  }

  setMode(mode) {
    this.mode = mode;
    this._onLog("CONTROL", `Kontrol modu: ${mode === "auto_pick_place" ? "Otonom Görev" : "Manuel 6-DOF"}`);
  }

  goHome() {
    this.mode = "manual_joints";
    this.heldCube = null;
    this.trajectory.moveTo(this.joints, HOME_JOINTS, 0.78);
    this._onLog("ARM", "Robot kol HOME başlangıç konumuna dönüyor.");
  }

  setManualJoint(key, deg) {
    this.mode = "manual_joints";
    const [lo, hi] = JOINT_LIMITS[key];
    const target = { ...this.joints, [key]: clamp(deg, lo, hi) };
    this.trajectory.moveTo(this.joints, target, 0.14);
  }

  _planIK(x, y, z, yawDeg, gripperDeg, dur) {
    const { joints } = inverseKinematics(x, y, z, 180.0, yawDeg, gripperDeg);
    this.trajectory.moveTo(this.joints, joints, dur / Math.max(0.35, this.speedMultiplier));
  }

  _stepMission(dt) {
    if (this.paused || this.mode !== "auto_pick_place" || !this.trajectory.done) return;
    if (this._phaseWait > 0) {
      this._phaseWait -= dt;
      return;
    }

    if (this.phase === "SCANNING") {
      const waiting = this.cubes.filter((c) => c.status === "WAITING");
      if (!waiting.length) {
        this._onLog("MISSION", "Tüm küpler ayrıştırıldı — yeni parti hazırlanıyor.");
        this.resetCubes();
        return;
      }
      const c = waiting[0];
      c.status = "LOCKED";
      this.activeCube = c;
      this._onLog("VISION", `${c.id} (${c.colorTr}) kilitlendi → Hedef: ${c.targetZone}`);
      this._planIK(c.pos[0], 0.115, c.pos[2], c.yawDeg, GRIPPER_OPEN_DEG, 0.92);
      this.phase = "APPROACH_ABOVE";
    } else if (this.phase === "APPROACH_ABOVE" && this.activeCube) {
      const c = this.activeCube;
      this._planIK(c.pos[0], c.sizeM * 0.5 + 0.002, c.pos[2], c.yawDeg, GRIPPER_OPEN_DEG, 0.62);
      this.phase = "DESCEND_PICK";
    } else if (this.phase === "DESCEND_PICK" && this.activeCube) {
      const target = { ...this.joints, j6_gripper: GRIPPER_CUBE_38MM_DEG };
      this.trajectory.moveTo(this.joints, target, 0.34 / Math.max(0.35, this.speedMultiplier));
      this.phase = "GRIP_CLOSE";
    } else if (this.phase === "GRIP_CLOSE" && this.activeCube) {
      const c = this.activeCube;
      c.status = "IN_GRIPPER";
      this.heldCube = c;
      this._onLog("ARM", `${c.id} kavrandı (kıskaç 38.0 mm), kaldırılıyor.`);
      this._planIK(c.pos[0], 0.135, c.pos[2], c.yawDeg, GRIPPER_CUBE_38MM_DEG, 0.62);
      this.phase = "LIFT_CUBE";
    } else if (this.phase === "LIFT_CUBE" && this.activeCube) {
      const c = this.activeCube;
      const [zx, , zz] = COLOR_PROFILES[c.colorKey].zonePos;
      this._planIK(zx, 0.135, zz, 0.0, GRIPPER_CUBE_38MM_DEG, 1.0);
      this.phase = "TRANSIT_TO_ZONE";
    } else if (this.phase === "TRANSIT_TO_ZONE" && this.activeCube) {
      const c = this.activeCube;
      const [zx, , zz] = COLOR_PROFILES[c.colorKey].zonePos;
      this._planIK(zx, c.sizeM * 0.5 + 0.002, zz, 0.0, GRIPPER_CUBE_38MM_DEG, 0.62);
      this.phase = "DESCEND_DROP";
    } else if (this.phase === "DESCEND_DROP" && this.activeCube) {
      const target = { ...this.joints, j6_gripper: GRIPPER_OPEN_DEG };
      this.trajectory.moveTo(this.joints, target, 0.3 / Math.max(0.35, this.speedMultiplier));
      this.phase = "GRIP_RELEASE";
    } else if (this.phase === "GRIP_RELEASE" && this.activeCube) {
      const c = this.activeCube;
      const [zx, , zz] = COLOR_PROFILES[c.colorKey].zonePos;
      c.pos = [zx, c.sizeM * 0.5, zz];
      c.yawDeg = 0;
      c.status = "SORTED";
      this.heldCube = null;
      this.sortedCount++;
      this._onLog("SORTED", `${c.id} → ${c.targetZone} bırakıldı (Toplam: ${this.sortedCount}).`);
      this._planIK(zx, 0.125, zz, 0.0, GRIPPER_OPEN_DEG, 0.52);
      this.phase = "RETRACT";
    } else if (this.phase === "RETRACT") {
      this.activeCube = null;
      this.trajectory.moveTo(this.joints, HOME_JOINTS, 0.7 / Math.max(0.35, this.speedMultiplier));
      this.phase = "SCANNING";
      this._phaseWait = 0.35;
    }
  }

  step(dt, hwBusVoltage = null) {
    this._stepMission(dt);
    if (!this.trajectory.done) {
      const res = this.trajectory.step(dt);
      this.joints = res.joints;
      this.velocities = res.velocities;
    } else {
      for (const k of Object.keys(this.velocities)) this.velocities[k] = 0;
    }

    const fk = forwardKinematics(this.joints);
    if (this.heldCube) {
      this.heldCube.pos = [
        Number(fk.tip[0].toFixed(4)),
        Number(Math.max(this.heldCube.sizeM * 0.5, fk.tip[1]).toFixed(4)),
        Number(fk.tip[2].toFixed(4)),
      ];
      this.heldCube.yawDeg = Number((this.joints.j1_base + this.joints.j5_wrist_roll).toFixed(1));
    }

    const carryKg = this.heldCube ? 0.022 : 0.0;
    this.electrical = this.elecModel.step(this.joints, this.velocities, carryKg, dt, hwBusVoltage);
    return { fk, electrical: this.electrical };
  }
}
