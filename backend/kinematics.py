"""
6-DOF 3D-Printed Robotic Arm Kinematics, Servo PWM & Electrical Physics
-----------------------------------------------------------------------
Coordinate system (Three.js / Robotics Y-up, meters):
  - Origin (0, 0, 0): Center of robot arm base on the workbench surface (Y = 0)
  - +Z: Forward toward the pickup workbench
  - +X: Right side of the workbench
  - +Y: Vertically up

Unreal Engine 5 transform (Z-up, centimeters):
  - UE5.X (forward) = Z * 100
  - UE5.Y (right)   = X * 100
  - UE5.Z (up)      = Y * 100
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Tuple


# Physical link lengths (meters) matching a 3D-printed DS3218/MG996R 6-DOF arm
L0_BASE_HEIGHT = 0.095     # Table surface to shoulder pivot (9.5 cm)
L1_UPPER_ARM = 0.175       # Shoulder to elbow (17.5 cm)
L2_FOREARM = 0.165         # Elbow to wrist pitch (16.5 cm)
L3_GRIPPER_LEN = 0.095     # Wrist pitch pivot to gripper fingertip center (9.5 cm)

# Servo physical limits (degrees)
JOINT_LIMITS: Dict[str, Tuple[float, float]] = {
    "j1_base": (-135.0, 135.0),
    "j2_shoulder": (-75.0, 82.0),
    "j3_elbow": (-110.0, 125.0),
    "j4_wrist_pitch": (-100.0, 100.0),
    "j5_wrist_roll": (-180.0, 180.0),
    "j6_gripper": (0.0, 90.0),  # 0 = 22mm min stop, 32.73 = exact 38.0mm cube grip, 90 = 66mm open
}

# Hardware calibration matching firmware/esp32_arm_controller/esp32_arm_controller.ino
# Mechanical center offsets keep every 180-deg servo comfortably inside [20°, 165°] (no 2500us saturation!)
SERVO_HW_SPEC: Dict[str, Dict[str, object]] = {
    "j1_base":        {"channel": 0, "model": "DS3218 (20kg)", "center": 90.0, "dir": 1.0, "max_ma": 2200.0},
    "j2_shoulder":    {"channel": 1, "model": "DS3218 (20kg)", "center": 90.0, "dir": 1.0, "max_ma": 2400.0},
    "j3_elbow":       {"channel": 2, "model": "DS3218 (20kg)", "center": 35.0, "dir": 1.0, "max_ma": 2200.0},
    "j4_wrist_pitch": {"channel": 3, "model": "MG996R (10kg)", "center": 45.0, "dir": 1.0, "max_ma": 1400.0},
    "j5_wrist_roll":  {"channel": 4, "model": "MG90S  (2kg)",  "center": 90.0, "dir": 1.0, "max_ma": 750.0},
    "j6_gripper":     {"channel": 5, "model": "MG90S  (2kg)",  "center": 10.0, "dir": 1.0, "max_ma": 750.0},
}

# Exact gripper angle for flush 38.0 mm grip: gap_mm = 22.0 + (j6 / 90.0) * 44.0
GRIPPER_CUBE_38MM_DEG = 32.73
GRIPPER_OPEN_DEG = 78.0

HOME_JOINTS: Dict[str, float] = {
    "j1_base": 0.0,
    "j2_shoulder": -14.0,
    "j3_elbow": 98.0,
    "j4_wrist_pitch": 96.0,
    "j5_wrist_roll": 0.0,
    "j6_gripper": GRIPPER_OPEN_DEG,
}


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def gripper_gap_mm(j6_deg: float) -> float:
    """Exact inner silicone-pad jaw opening (mm) for a given J6 servo angle."""
    return 22.0 + (clamp(j6_deg, 0.0, 90.0) / 90.0) * 44.0


def to_ue5_cm(pos: Tuple[float, float, float]) -> Dict[str, float]:
    """Convert right-handed Y-up meters to Unreal Engine 5 Z-up centimeters."""
    x, y, z = pos
    return {
        "x": round(z * 100.0, 2),
        "y": round(x * 100.0, 2),
        "z": round(y * 100.0, 2),
    }


def forward_kinematics(joints: Dict[str, float]) -> Dict[str, Tuple[float, float, float]]:
    """Compute exact 3D world positions (meters) of every joint and the gripper tip."""
    j1 = math.radians(joints.get("j1_base", 0.0))
    j2 = math.radians(joints.get("j2_shoulder", 0.0))
    j3 = math.radians(joints.get("j3_elbow", 0.0))
    j4 = math.radians(joints.get("j4_wrist_pitch", 0.0))

    sin1, cos1 = math.sin(j1), math.cos(j1)

    r_sh, y_sh = 0.0, L0_BASE_HEIGHT
    r_el = L1_UPPER_ARM * math.sin(j2)
    y_el = y_sh + L1_UPPER_ARM * math.cos(j2)

    phi2 = j2 + j3
    r_wr = r_el + L2_FOREARM * math.sin(phi2)
    y_wr = y_el + L2_FOREARM * math.cos(phi2)

    phi3 = phi2 + j4
    r_tip = r_wr + L3_GRIPPER_LEN * math.sin(phi3)
    y_tip = y_wr + L3_GRIPPER_LEN * math.cos(phi3)

    return {
        "base": (0.0, 0.0, 0.0),
        "shoulder": (r_sh * sin1, y_sh, r_sh * cos1),
        "elbow": (r_el * sin1, y_el, r_el * cos1),
        "wrist": (r_wr * sin1, y_wr, r_wr * cos1),
        "tip": (r_tip * sin1, y_tip, r_tip * cos1),
    }


def inverse_kinematics(
    target_x: float,
    target_y: float,
    target_z: float,
    approach_pitch_deg: float = 180.0,
    wrist_roll_deg: float = 0.0,
    gripper_deg: float = GRIPPER_OPEN_DEG,
) -> Tuple[Dict[str, float], bool]:
    """
    Analytical 6-DOF elbow-up Inverse Kinematics.
    approach_pitch_deg = 180.0 means gripper points straight down (-Y) onto the workbench.
    """
    j1_rad = math.atan2(target_x, target_z) if (abs(target_x) > 1e-5 or abs(target_z) > 1e-5) else 0.0
    j1_deg = math.degrees(j1_rad)

    r_target = math.hypot(target_x, target_z)
    phi3 = math.radians(approach_pitch_deg)

    r_w = r_target - L3_GRIPPER_LEN * math.sin(phi3)
    y_w = target_y - L3_GRIPPER_LEN * math.cos(phi3)

    dr = r_w
    dy = y_w - L0_BASE_HEIGHT
    dist = math.hypot(dr, dy)

    min_reach = abs(L1_UPPER_ARM - L2_FOREARM) + 0.015
    max_reach = (L1_UPPER_ARM + L2_FOREARM) - 0.008
    reachable = (min_reach <= dist <= max_reach) and (-135.0 <= j1_deg <= 135.0)

    clamped_dist = clamp(dist, min_reach, max_reach)
    if dist > 1e-6 and clamped_dist != dist:
        scale = clamped_dist / dist
        dr *= scale
        dy *= scale
        dist = clamped_dist

    cos_j3 = (dist * dist - L1_UPPER_ARM ** 2 - L2_FOREARM ** 2) / (2.0 * L1_UPPER_ARM * L2_FOREARM)
    cos_j3 = clamp(cos_j3, -1.0, 1.0)
    j3_rad = math.acos(cos_j3)

    alpha = math.atan2(dr, dy)
    cos_beta = (L1_UPPER_ARM ** 2 + dist * dist - L2_FOREARM ** 2) / (2.0 * L1_UPPER_ARM * dist)
    cos_beta = clamp(cos_beta, -1.0, 1.0)
    beta = math.acos(cos_beta)

    j2_rad = alpha - beta
    j4_rad = phi3 - (j2_rad + j3_rad)

    # Fold square cube yaw into minimal rotation range so wrist doesn't over-twist
    raw_roll = ((wrist_roll_deg - j1_deg + 180.0) % 360.0) - 180.0

    joints = {
        "j1_base": clamp(j1_deg, *JOINT_LIMITS["j1_base"]),
        "j2_shoulder": clamp(math.degrees(j2_rad), *JOINT_LIMITS["j2_shoulder"]),
        "j3_elbow": clamp(math.degrees(j3_rad), *JOINT_LIMITS["j3_elbow"]),
        "j4_wrist_pitch": clamp(math.degrees(j4_rad), *JOINT_LIMITS["j4_wrist_pitch"]),
        "j5_wrist_roll": clamp(raw_roll, *JOINT_LIMITS["j5_wrist_roll"]),
        "j6_gripper": clamp(gripper_deg, *JOINT_LIMITS["j6_gripper"]),
    }

    return joints, reachable


class ElectricalPhysicsModel:
    """
    Stateful electrical & thermal model for 6x servos + PCA9685 + 6.0V 8A UBEC power bus.
    Computes exact PWM pulse width (us), PCA9685 12-bit ticks, gravity torque, current draw,
    bus voltage sag, and slow realistic servo thermal rise.
    """

    def __init__(self) -> None:
        self.ambient_c = 24.4
        self.servo_temps_c: Dict[str, float] = {k: self.ambient_c for k in JOINT_LIMITS}
        self.ubec_temp_c: float = 27.0

    def step(
        self,
        joints: Dict[str, float],
        velocities: Dict[str, float],
        carrying_mass_kg: float,
        dt: float,
    ) -> Dict[str, object]:
        fk = forward_kinematics(joints)
        tip = fk["tip"]
        elbow = fk["elbow"]
        wrist = fk["wrist"]

        r_elbow = math.hypot(elbow[0], elbow[2])
        r_wrist = math.hypot(wrist[0], wrist[2])
        r_tip = math.hypot(tip[0], tip[2])

        # Realistic component masses (kg):
        # Upper arm PLA (0.095) + Elbow DS3218 (0.060) + Forearm PLA (0.075) + Wrist/Gripper (0.115)
        g = 9.81
        tau_shoulder = (
            0.095 * (r_elbow * 0.5)
            + 0.060 * r_elbow
            + 0.075 * ((r_elbow + r_wrist) * 0.5)
            + (0.115 + carrying_mass_kg) * r_tip
        ) * g
        tau_elbow = (
            0.075 * max(0.01, (r_wrist - r_elbow) * 0.5)
            + (0.115 + carrying_mass_kg) * max(0.015, r_tip - r_elbow)
        ) * g

        currents_ma: Dict[str, float] = {}
        pwm_channels: Dict[str, Dict[str, object]] = {}
        total_ma = 0.0

        for name, spec in SERVO_HW_SPEC.items():
            logical_deg = joints.get(name, 0.0)
            phys_deg = clamp(float(spec["center"]) + float(spec["dir"]) * logical_deg, 0.0, 180.0)
            pwm_us = round(500.0 + (phys_deg / 180.0) * 2000.0)
            pca_tick = int(round((pwm_us / 20000.0) * 4096.0))

            speed = abs(velocities.get(name, 0.0))
            idle_ma = 38.0 if "DS3218" in str(spec["model"]) else 22.0
            dyn_ma = min(float(spec["max_ma"]) * 0.48, speed * (5.2 if "DS3218" in str(spec["model"]) else 2.6))
            load_ma = 0.0
            if name == "j2_shoulder":
                # DS3218 K_t ~ 1.96 N*m / 2.4 A => ~1220 mA per N*m
                load_ma = tau_shoulder * 980.0
            elif name == "j3_elbow":
                load_ma = tau_elbow * 920.0
            elif name == "j4_wrist_pitch":
                load_ma = (0.05 + carrying_mass_kg) * 0.06 * g * 1100.0
            elif name == "j6_gripper" and carrying_mass_kg > 0.0:
                load_ma = 215.0  # Holding pinch force against 38mm cube

            cur_ma = round(min(float(spec["max_ma"]), idle_ma + dyn_ma + load_ma), 1)
            currents_ma[name] = cur_ma
            total_ma += cur_ma

            # First-order RC thermal model (tau ~ 45s)
            p_loss_w = (cur_ma / 1000.0) * 6.0 * 0.35
            target_t = self.ambient_c + p_loss_w * 4.8
            self.servo_temps_c[name] += (target_t - self.servo_temps_c[name]) * min(1.0, dt * 0.06)

            pwm_channels[name] = {
                "ch": spec["channel"],
                "model": spec["model"],
                "phys_deg": round(phys_deg, 1),
                "pwm_us": pwm_us,
                "pca_tick": pca_tick,
                "current_ma": cur_ma,
                "temp_c": round(self.servo_temps_c[name], 1),
            }

        # ESP32 + PCA9685 logic rail (~180 mA @ 5V) + Servo 6.0V UBEC bus
        total_a = total_ma / 1000.0
        # 6.0V UBEC output impedance + wire resistance (~0.065 Ohm)
        bus_voltage = round(6.00 - total_a * 0.065, 2)
        power_w = round(bus_voltage * total_a, 2)
        self.ubec_temp_c += ((26.5 + power_w * 0.95) - self.ubec_temp_c) * min(1.0, dt * 0.05)

        return {
            "bus_voltage_v": bus_voltage,
            "total_current_a": round(total_a, 2),
            "power_w": power_w,
            "ubec_temp_c": round(self.ubec_temp_c, 1),
            "shoulder_torque_nm": round(tau_shoulder, 3),
            "shoulder_torque_kgcm": round(tau_shoulder * 10.197, 2),
            "elbow_torque_nm": round(tau_elbow, 3),
            "jaw_gap_mm": round(gripper_gap_mm(joints.get("j6_gripper", GRIPPER_OPEN_DEG)), 1),
            "servo_currents_ma": currents_ma,
            "pwm_channels": pwm_channels,
        }


@dataclass
class SmoothTrajectory:
    """Minimum-jerk (quintic S-curve) joint-space interpolator."""

    start: Dict[str, float] = field(default_factory=lambda: dict(HOME_JOINTS))
    target: Dict[str, float] = field(default_factory=lambda: dict(HOME_JOINTS))
    duration: float = 1.0
    elapsed: float = 1.0

    def move_to(self, current: Dict[str, float], target: Dict[str, float], duration: float) -> None:
        self.start = dict(current)
        self.target = dict(target)
        self.duration = max(0.08, duration)
        self.elapsed = 0.0

    @property
    def done(self) -> bool:
        return self.elapsed >= self.duration

    def step(self, dt: float) -> Tuple[Dict[str, float], Dict[str, float]]:
        prev_t = clamp(self.elapsed / self.duration, 0.0, 1.0)
        self.elapsed = min(self.duration, self.elapsed + dt)
        t = clamp(self.elapsed / self.duration, 0.0, 1.0)

        s = t * t * t * (10.0 + t * (-15.0 + 6.0 * t))
        prev_s = prev_t * prev_t * prev_t * (10.0 + prev_t * (-15.0 + 6.0 * prev_t))

        joints: Dict[str, float] = {}
        velocities: Dict[str, float] = {}
        for k in JOINT_LIMITS:
            a = self.start.get(k, 0.0)
            b = self.target.get(k, a)
            val = a + (b - a) * s
            prev_val = a + (b - a) * prev_s
            joints[k] = val
            velocities[k] = (val - prev_val) / max(dt, 1e-4)

        return joints, velocities
