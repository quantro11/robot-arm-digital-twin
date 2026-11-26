/**
 * 6-DOF 3D-Printed Robotic Arm Kinematics, Minimum-Jerk Trajectory & Electrical Physics
 * -------------------------------------------------------------------------------------
 * Exact 1:1 browser-native engine matching firmware/esp32_arm_controller.ino & backend/kinematics.py.
 * Coordinate system (Y-up, meters): Origin (0,0,0) at base center on workbench top (Y=0).
 */

export const L0_BASE_HEIGHT = 0.095;
export const L1_UPPER_ARM = 0.175;
export const L2_FOREARM = 0.165;
export const L3_GRIPPER_LEN = 0.095;

export const JOINT_LIMITS = {
  j1_base: [-135, 135],
  j2_shoulder: [-75, 82],
  j3_elbow: [-110, 125],
  j4_wrist_pitch: [-100, 100],
  j5_wrist_roll: [-180, 180],
  j6_gripper: [0, 90],
};

// Synchronized 1:1 with firmware/esp32_arm_controller/esp32_arm_controller.ino
export const SERVO_HW_SPEC = {
  j1_base:        { ch: 0, model: "DS3218 (20kg)", center: 90, dir: 1, maxMa: 2200 },
  j2_shoulder:    { ch: 1, model: "DS3218 (20kg)", center: 90, dir: 1, maxMa: 2400 },
  j3_elbow:       { ch: 2, model: "DS3218 (20kg)", center: 35, dir: 1, maxMa: 2200 },
  j4_wrist_pitch: { ch: 3, model: "MG996R (10kg)", center: 45, dir: 1, maxMa: 1400 },
  j5_wrist_roll:  { ch: 4, model: "MG90S (2kg)",   center: 90, dir: 1, maxMa: 750 },
  j6_gripper:     { ch: 5, model: "MG90S (2kg)",   center: 10, dir: 1, maxMa: 750 },
};

// gap_mm = 22 + (j6 / 90) * 44  =>  32.73 deg = exact 38.00 mm flush grip!
export const GRIPPER_CUBE_38MM_DEG = 32.73;
export const GRIPPER_OPEN_DEG = 78.0;

export const HOME_JOINTS = {
  j1_base: 0.0,
  j2_shoulder: -14.0,
  j3_elbow: 98.0,
  j4_wrist_pitch: 96.0,
  j5_wrist_roll: 0.0,
  j6_gripper: GRIPPER_OPEN_DEG,
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

export function gripperGapMm(j6Deg) {
  return 22.0 + (clamp(j6Deg, 0, 90) / 90.0) * 44.0;
}

export function forwardKinematics(joints) {
  const j1 = deg2rad(joints.j1_base || 0);
  const j2 = deg2rad(joints.j2_shoulder || 0);
  const j3 = deg2rad(joints.j3_elbow || 0);
  const j4 = deg2rad(joints.j4_wrist_pitch || 0);

  const sin1 = Math.sin(j1);
  const cos1 = Math.cos(j1);

  const ySh = L0_BASE_HEIGHT;
  const rEl = L1_UPPER_ARM * Math.sin(j2);
  const yEl = ySh + L1_UPPER_ARM * Math.cos(j2);

  const phi2 = j2 + j3;
  const rWr = rEl + L2_FOREARM * Math.sin(phi2);
  const yWr = yEl + L2_FOREARM * Math.cos(phi2);

  const phi3 = phi2 + j4;
  const rTip = rWr + L3_GRIPPER_LEN * Math.sin(phi3);
  const yTip = yWr + L3_GRIPPER_LEN * Math.cos(phi3);

  return {
    base: [0, 0, 0],
    shoulder: [0, ySh, 0],
    elbow: [rEl * sin1, yEl, rEl * cos1],
    wrist: [rWr * sin1, yWr, rWr * cos1],
    tip: [rTip * sin1, yTip, rTip * cos1],
  };
}

export function inverseKinematics(
  tx,
  ty,
  tz,
  approachPitchDeg = 180.0,
  wristRollDeg = 0.0,
  gripperDeg = GRIPPER_OPEN_DEG
) {
  const j1Rad = Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5 ? Math.atan2(tx, tz) : 0;
  const j1Deg = rad2deg(j1Rad);
  const rTarget = Math.hypot(tx, tz);
  const phi3 = deg2rad(approachPitchDeg);

  const rW = rTarget - L3_GRIPPER_LEN * Math.sin(phi3);
  const yW = ty - L3_GRIPPER_LEN * Math.cos(phi3);

  let dr = rW;
  let dy = yW - L0_BASE_HEIGHT;
  let dist = Math.hypot(dr, dy);

  const minReach = Math.abs(L1_UPPER_ARM - L2_FOREARM) + 0.015;
  const maxReach = L1_UPPER_ARM + L2_FOREARM - 0.008;
  const reachable = dist >= minReach && dist <= maxReach && j1Deg >= -135 && j1Deg <= 135;

  const clampedDist = clamp(dist, minReach, maxReach);
  if (dist > 1e-6 && clampedDist !== dist) {
    const s = clampedDist / dist;
    dr *= s;
    dy *= s;
    dist = clampedDist;
  }

  const cosJ3 = clamp(
    (dist * dist - L1_UPPER_ARM ** 2 - L2_FOREARM ** 2) / (2 * L1_UPPER_ARM * L2_FOREARM),
    -1,
    1
  );
  const j3Rad = Math.acos(cosJ3);

  const alpha = Math.atan2(dr, dy);
  const cosBeta = clamp(
    (L1_UPPER_ARM ** 2 + dist * dist - L2_FOREARM ** 2) / (2 * L1_UPPER_ARM * dist),
    -1,
    1
  );
  const beta = Math.acos(cosBeta);

  const j2Rad = alpha - beta;
  const j4Rad = phi3 - (j2Rad + j3Rad);
  const rawRoll = ((((wristRollDeg - j1Deg + 180) % 360) + 360) % 360) - 180;

  return {
    reachable,
    joints: {
      j1_base: clamp(j1Deg, ...JOINT_LIMITS.j1_base),
      j2_shoulder: clamp(rad2deg(j2Rad), ...JOINT_LIMITS.j2_shoulder),
      j3_elbow: clamp(rad2deg(j3Rad), ...JOINT_LIMITS.j3_elbow),
      j4_wrist_pitch: clamp(rad2deg(j4Rad), ...JOINT_LIMITS.j4_wrist_pitch),
      j5_wrist_roll: clamp(rawRoll, ...JOINT_LIMITS.j5_wrist_roll),
      j6_gripper: clamp(gripperDeg, ...JOINT_LIMITS.j6_gripper),
    },
  };
}

export class SmoothTrajectory {
  constructor() {
    this.start = { ...HOME_JOINTS };
    this.target = { ...HOME_JOINTS };
    this.duration = 1.0;
    this.elapsed = 1.0;
  }

  moveTo(current, target, duration) {
    this.start = { ...current };
    this.target = { ...target };
    this.duration = Math.max(0.08, duration);
    this.elapsed = 0.0;
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  step(dt) {
    const prevT = clamp(this.elapsed / this.duration, 0, 1);
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    const t = clamp(this.elapsed / this.duration, 0, 1);

    // Quintic minimum-jerk S-curve
    const s = t * t * t * (10 + t * (-15 + 6 * t));
    const prevS = prevT * prevT * prevT * (10 + prevT * (-15 + 6 * prevT));

    const joints = {};
    const velocities = {};
    for (const k of Object.keys(JOINT_LIMITS)) {
      const a = this.start[k] ?? 0;
      const b = this.target[k] ?? a;
      const v = a + (b - a) * s;
      const pv = a + (b - a) * prevS;
      joints[k] = v;
      velocities[k] = (v - pv) / Math.max(dt, 1e-4);
    }
    return { joints, velocities };
  }
}

export class ElectricalPhysicsModel {
  constructor() {
    this.ambientC = 24.4;
    this.servoTemps = {};
    for (const k of Object.keys(JOINT_LIMITS)) this.servoTemps[k] = this.ambientC;
    this.ubecTempC = 27.0;
  }

  step(joints, velocities, carryingKg, dt, hwBusVoltage = null) {
    const fk = forwardKinematics(joints);
    const rEl = Math.hypot(fk.elbow[0], fk.elbow[2]);
    const rWr = Math.hypot(fk.wrist[0], fk.wrist[2]);
    const rTip = Math.hypot(fk.tip[0], fk.tip[2]);
    const g = 9.81;

    const tauShoulder =
      (0.095 * (rEl * 0.5) +
        0.06 * rEl +
        0.075 * ((rEl + rWr) * 0.5) +
        (0.115 + carryingKg) * rTip) *
      g;
    const tauElbow =
      (0.075 * Math.max(0.01, (rWr - rEl) * 0.5) +
        (0.115 + carryingKg) * Math.max(0.015, rTip - rEl)) *
      g;

    const pwmChannels = {};
    let totalMa = 0;

    for (const [name, spec] of Object.entries(SERVO_HW_SPEC)) {
      const logical = joints[name] || 0;
      const physDeg = clamp(spec.center + spec.dir * logical, 0, 180);
      const pwmUs = Math.round(500 + (physDeg / 180) * 2000);
      const pcaTick = Math.round((pwmUs / 20000) * 4096);

      const speed = Math.abs(velocities[name] || 0);
      const isDS = spec.model.includes("DS3218");
      const idleMa = isDS ? 38 : 22;
      const dynMa = Math.min(spec.maxMa * 0.48, speed * (isDS ? 5.2 : 2.6));
      let loadMa = 0;
      if (name === "j2_shoulder") loadMa = tauShoulder * 980;
      else if (name === "j3_elbow") loadMa = tauElbow * 920;
      else if (name === "j4_wrist_pitch") loadMa = (0.05 + carryingKg) * 0.06 * g * 1100;
      else if (name === "j6_gripper" && carryingKg > 0) loadMa = 215;

      const curMa = Math.min(spec.maxMa, idleMa + dynMa + loadMa);
      totalMa += curMa;

      const pLoss = (curMa / 1000) * 6.0 * 0.35;
      this.servoTemps[name] += (this.ambientC + pLoss * 4.8 - this.servoTemps[name]) * Math.min(1, dt * 0.06);

      pwmChannels[name] = {
        ch: spec.ch,
        model: spec.model,
        physDeg: Number(physDeg.toFixed(1)),
        pwmUs,
        pcaTick,
        currentMa: Number(curMa.toFixed(1)),
        tempC: Number(this.servoTemps[name].toFixed(1)),
      };
    }

    const totalA = totalMa / 1000;
    const busVoltage = hwBusVoltage ?? Number((6.0 - totalA * 0.065).toFixed(2));
    const powerW = Number((busVoltage * totalA).toFixed(2));
    this.ubecTempC += (26.5 + powerW * 0.95 - this.ubecTempC) * Math.min(1, dt * 0.05);

    return {
      busVoltageV: busVoltage,
      totalCurrentA: Number(totalA.toFixed(2)),
      powerW,
      ubecTempC: Number(this.ubecTempC.toFixed(1)),
      shoulderTorqueNm: Number(tauShoulder.toFixed(3)),
      shoulderTorqueKgCm: Number((tauShoulder * 10.197).toFixed(2)),
      elbowTorqueNm: Number(tauElbow.toFixed(3)),
      jawGapMm: Number(gripperGapMm(joints.j6_gripper ?? GRIPPER_OPEN_DEG).toFixed(1)),
      pwmChannels,
    };
  }
}
