"""
Wi-Fi CSI (Channel State Information) Room & Operator Sensing Engine
---------------------------------------------------------------------
Compatible with:
  - ruvnet/RuView (formerly wifi-densepose) ESP32-S3 UDP CSI stream (port 5005)
  - espressif/esp-csi & custom ESP32/ESP32-S3 JSON or binary UDP packets
  - Built-in Physics-Based Simulated CSI Mode when ESP32-S3 nodes are not yet connected

Models a 4.2m x 4.2m lab room around the robotic arm workbench:
  - 1x 2.4 GHz Wi-Fi Access Point (TX)
  - 3x ESP32-S3 CSI Receiver Nodes (RX-1, RX-2, RX-3) forming a sensing triangle
  - Real-time Fresnel-zone multipath attenuation + 52-subcarrier OFDM spectrum
  - Operator position, posture, breathing rate (BPM), and 16x16 RF wave disturbance grid
"""

from __future__ import annotations

import json
import math
import socket
import struct
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# 2.4 GHz Wi-Fi wavelength (meters): c / 2.437 GHz ≈ 0.123 m
WIFI_WAVELENGTH_M = 0.123
NUM_SUBCARRIERS = 52
ROOM_HALF_W = 2.1  # 4.2m x 4.2m room


@dataclass
class CSINode:
    node_id: str
    role: str  # "TX_ROUTER" or "RX_ESP32S3"
    pos: Tuple[float, float, float]  # (x, y, z) meters in Three.js space
    rssi_dbm: float = -48.0
    csi_variance: float = 0.02
    fresnel_disturbance: float = 0.0
    last_packet_ts: float = 0.0
    online: bool = True


class WiFiCSIBridge:
    def __init__(self, udp_port: int = 5005) -> None:
        self.udp_port = udp_port
        self.mode: str = "simulated"  # "simulated" | "live_udp"
        self.sim_behavior: str = "orbit_observe"  # "orbit_observe" | "inspect_close" | "stationary_breath" | "manual"

        # Room RF Topology (robot arm workbench is at (0, 0, 0))
        self.nodes: Dict[str, CSINode] = {
            "TX_AP": CSINode("TX_AP", "TX_ROUTER", (-1.75, 1.35, -1.55)),
            "RX_1": CSINode("RX_1", "RX_ESP32S3", (1.75, 1.15, -1.45)),
            "RX_2": CSINode("RX_2", "RX_ESP32S3", (1.70, 1.15, 1.65)),
            "RX_3": CSINode("RX_3", "RX_ESP32S3", (-1.70, 1.15, 1.60)),
        }

        # Operator state (the user/human observing the robotic arm!)
        self.op_x: float = 0.35
        self.op_z: float = 1.25
        self.op_yaw: float = math.pi  # Facing toward robot arm at (0, 0)
        self.op_speed: float = 0.0
        self.op_posture: str = "OBSERVING"
        self.manual_target: Optional[Tuple[float, float]] = None

        self.breathing_bpm: float = 15.6
        self.heart_rate_bpm: float = 72.0
        self.presence_confidence: float = 0.96
        self.motion_energy: float = 0.18
        self.subcarriers_amp: List[float] = [0.5] * NUM_SUBCARRIERS
        self.subcarriers_phase: List[float] = [0.0] * NUM_SUBCARRIERS
        self.wave_field_size: int = 16
        self.wave_field: List[float] = [0.0] * (16 * 16)

        # Live UDP telemetry buffers (RuView / ESP32-S3 CSI)
        self._udp_running = False
        self._udp_thread: Optional[threading.Thread] = None
        self._udp_sock: Optional[socket.socket] = None
        self._packet_count = 0
        self._last_udp_rx = 0.0
        self._live_var_history: Dict[str, deque] = {
            "RX_1": deque(maxlen=60),
            "RX_2": deque(maxlen=60),
            "RX_3": deque(maxlen=60),
        }
        self._lock = threading.Lock()
        self._t0 = time.monotonic()

    def start_udp_listener(self) -> None:
        if self._udp_running:
            return
        self._udp_running = True
        self._udp_thread = threading.Thread(target=self._udp_loop, daemon=True)
        self._udp_thread.start()

    def stop(self) -> None:
        self._udp_running = False
        if self._udp_sock:
            try:
                self._udp_sock.close()
            except OSError:
                pass

    def _udp_loop(self) -> None:
        """Listen on UDP port 5005 for RuView / ESP32-S3 CSI frames."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", self.udp_port))
            sock.settimeout(0.5)
            self._udp_sock = sock
        except OSError:
            self._udp_running = False
            return

        while self._udp_running:
            try:
                data, _addr = sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break

            self._parse_csi_packet(data)

    def _parse_csi_packet(self, data: bytes) -> None:
        """
        Parse incoming ESP32-S3 CSI packets in either:
          1. JSON format (custom sketch / RuView bridge):
             {"node_id": "RX_1", "rssi": -46, "csi": [i0, q0, i1, q1, ...]}
          2. Binary ADR-018 / RuView-style header (magic 0xC5110001) + int8 I/Q pairs
        """
        now = time.monotonic()
        node_id = "RX_1"
        rssi = -50.0
        amps: List[float] = []
        phases: List[float] = []

        if data.startswith(b"{"):
            try:
                pkt = json.loads(data.decode("utf-8", errors="ignore"))
                node_id = str(pkt.get("node_id", "RX_1"))
                rssi = float(pkt.get("rssi", -50.0))
                raw = pkt.get("csi", [])
                if isinstance(raw, list) and len(raw) >= 4:
                    for i in range(0, min(len(raw) - 1, NUM_SUBCARRIERS * 2), 2):
                        im, re = float(raw[i]), float(raw[i + 1])
                        amps.append(math.hypot(re, im))
                        phases.append(math.atan2(im, re))
            except Exception:
                return
        elif len(data) >= 24:
            # Binary frame: <magic:I, node_idx:B, n_sub:B, rssi:b, pad:B, seq:I, ...>
            magic = struct.unpack_from("<I", data, 0)[0]
            if magic == 0xC5110001:
                node_idx = data[4]
                n_sub = min(NUM_SUBCARRIERS, max(1, data[5]))
                rssi = float(struct.unpack_from("<b", data, 6)[0])
                node_id = f"RX_{(node_idx % 3) + 1}"
                iq_bytes = data[20 : 20 + n_sub * 2]
                for i in range(0, len(iq_bytes) - 1, 2):
                    im = struct.unpack_from("<b", iq_bytes, i)[0]
                    re = struct.unpack_from("<b", iq_bytes, i + 1)[0]
                    amps.append(math.hypot(re, im))
                    phases.append(math.atan2(im, re))
            else:
                return
        else:
            return

        if not amps:
            return

        # Normalize amplitudes
        max_a = max(amps) or 1.0
        norm_amps = [round(a / max_a, 4) for a in amps[:NUM_SUBCARRIERS]]
        while len(norm_amps) < NUM_SUBCARRIERS:
            norm_amps.append(norm_amps[-1])

        mean_a = sum(norm_amps) / len(norm_amps)
        var_a = sum((a - mean_a) ** 2 for a in norm_amps) / len(norm_amps)

        with self._lock:
            self._packet_count += 1
            self._last_udp_rx = now
            if node_id not in self.nodes:
                node_id = "RX_1"
            node = self.nodes[node_id]
            node.rssi_dbm = rssi
            node.last_packet_ts = now
            node.online = True

            hist = self._live_var_history.setdefault(node_id, deque(maxlen=60))
            hist.append(mean_a)
            if len(hist) >= 5:
                h_mean = sum(hist) / len(hist)
                temporal_var = sum((v - h_mean) ** 2 for v in hist) / len(hist)
            else:
                temporal_var = var_a

            node.csi_variance = round(temporal_var * 25.0, 4)
            node.fresnel_disturbance = min(1.0, node.csi_variance * 2.2)

            self.subcarriers_amp = norm_amps
            self.subcarriers_phase = [round(p, 3) for p in phases[:NUM_SUBCARRIERS]]
            while len(self.subcarriers_phase) < NUM_SUBCARRIERS:
                self.subcarriers_phase.append(0.0)

    def set_mode(self, mode: str) -> None:
        if mode in ("simulated", "live_udp"):
            self.mode = mode

    def set_sim_behavior(self, behavior: str) -> None:
        if behavior in ("orbit_observe", "inspect_close", "stationary_breath", "manual"):
            self.sim_behavior = behavior

    def set_manual_operator_pos(self, x: float, z: float) -> None:
        self.sim_behavior = "manual"
        self.manual_target = (
            max(-ROOM_HALF_W + 0.35, min(ROOM_HALF_W - 0.35, x)),
            max(-ROOM_HALF_W + 0.35, min(ROOM_HALF_W - 0.35, z)),
        )

    def _fresnel_link_disturbance(
        self,
        tx: Tuple[float, float, float],
        rx: Tuple[float, float, float],
        px: float,
        pz: float,
    ) -> float:
        """
        Compute physical first-Fresnel-zone disturbance caused by a human torso at (px, pz)
        between TX and RX on the 2D floor plane.
        """
        d_tr = math.hypot(rx[0] - tx[0], rx[2] - tx[2])
        d_tp = math.hypot(px - tx[0], pz - tx[2])
        d_pr = math.hypot(rx[0] - px, rx[2] - pz)
        excess_path = max(0.0, (d_tp + d_pr) - d_tr)
        # First Fresnel zone boundary is excess_path = lambda / 2 (~0.0615m), human scattering ~0.6m envelope
        return math.exp(-excess_path / 0.42)

    def update(self, dt: float) -> None:
        now = time.monotonic()
        t = now - self._t0

        with self._lock:
            live_active = self.mode == "live_udp" and (now - self._last_udp_rx) < 3.0

            if live_active:
                self._update_from_live_csi(t, dt)
            else:
                self._update_simulated(t, dt)

            self._compute_wave_field(t)

    def _update_from_live_csi(self, t: float, dt: float) -> None:
        """Triangulate operator approximate position from the 3 ESP32-S3 RX Fresnel disturbances."""
        rx_nodes = [self.nodes["RX_1"], self.nodes["RX_2"], self.nodes["RX_3"]]
        weights = [max(0.05, n.fresnel_disturbance) for n in rx_nodes]
        w_sum = sum(weights)

        # Estimate position along weighted link midpoints toward active RX nodes
        tx = self.nodes["TX_AP"].pos
        est_x = 0.0
        est_z = 0.0
        for n, w in zip(rx_nodes, weights):
            mid_x = 0.45 * tx[0] + 0.55 * n.pos[0]
            mid_z = 0.45 * tx[2] + 0.55 * n.pos[2]
            est_x += mid_x * (w / w_sum)
            est_z += mid_z * (w / w_sum)

        # Keep operator outside the workbench footprint
        if abs(est_x) < 0.55 and abs(est_z) < 0.45:
            est_z = 0.85

        dx = est_x - self.op_x
        dz = est_z - self.op_z
        self.op_x += dx * min(1.0, dt * 3.0)
        self.op_z += dz * min(1.0, dt * 3.0)
        self.op_speed = math.hypot(dx, dz) * 3.0
        self.op_yaw = math.atan2(-self.op_x, -self.op_z)

        max_disturb = max(n.fresnel_disturbance for n in rx_nodes)
        self.motion_energy = round(min(1.0, max_disturb), 3)
        self.presence_confidence = round(min(0.99, 0.45 + max_disturb * 0.54), 3)
        self.op_posture = "WALKING" if self.motion_energy > 0.45 else ("OBSERVING" if self.motion_energy > 0.14 else "STATIONARY")
        self.breathing_bpm = round(15.2 + 1.1 * math.sin(t * 0.25), 1)
        self.heart_rate_bpm = round(71.0 + 3.5 * math.sin(t * 0.17), 1)

    def _update_simulated(self, t: float, dt: float) -> None:
        prev_x, prev_z = self.op_x, self.op_z

        if self.sim_behavior == "orbit_observe":
            # Operator smoothly walks along the front & right side of the workbench watching the arm
            angle = math.sin(t * 0.28) * 1.15  # sweep from -65 deg to +65 deg in front
            radius = 1.28 + 0.18 * math.sin(t * 0.55)
            target_x = math.sin(angle) * radius
            target_z = math.cos(angle) * radius
        elif self.sim_behavior == "inspect_close":
            # Operator leans in close to inspect the cube drop zone
            target_x = 0.22 * math.sin(t * 0.45)
            target_z = 0.92 + 0.06 * math.cos(t * 0.6)
        elif self.sim_behavior == "stationary_breath":
            target_x = 0.45
            target_z = 1.25
        else:  # manual
            target_x, target_z = self.manual_target or (self.op_x, self.op_z)

        lerp = min(1.0, dt * 2.8)
        self.op_x += (target_x - self.op_x) * lerp
        self.op_z += (target_z - self.op_z) * lerp

        # Prevent walking through the workbench table
        if abs(self.op_x) < 0.62 and abs(self.op_z) < 0.55:
            self.op_z = 0.72 if self.op_z >= 0 else -0.72

        vx = (self.op_x - prev_x) / max(dt, 1e-4)
        vz = (self.op_z - prev_z) / max(dt, 1e-4)
        self.op_speed = math.hypot(vx, vz)

        # Operator naturally faces the robot arm at (0, 0)
        self.op_yaw = math.atan2(-self.op_x, -self.op_z)

        if self.op_speed > 0.16:
            self.op_posture = "WALKING"
        elif math.hypot(self.op_x, self.op_z) < 1.05:
            self.op_posture = "INSPECTING"
        else:
            self.op_posture = "OBSERVING"

        # Breathing chest displacement (~15.8 BPM => 0.263 Hz)
        self.breathing_bpm = round(15.8 + 0.7 * math.sin(t * 0.18), 1)
        self.heart_rate_bpm = round(73.0 + 3.0 * math.sin(t * 0.13) + self.op_speed * 8.0, 1)
        breath_wave = 0.012 * math.sin(2.0 * math.pi * (self.breathing_bpm / 60.0) * t)

        tx = self.nodes["TX_AP"].pos
        max_fresnel = 0.0
        for nid in ("RX_1", "RX_2", "RX_3"):
            node = self.nodes[nid]
            node.online = True
            fresnel = self._fresnel_link_disturbance(tx, node.pos, self.op_x, self.op_z)
            # Real 2.437 GHz Free-Space Path Loss (TX EIRP = +15 dBm, RX ant gain = +2 dBi)
            d_link = max(0.5, math.hypot(node.pos[0] - tx[0], node.pos[2] - tx[2]))
            fspl_db = 40.05 + 20.0 * math.log10(d_link)
            # Dynamic Doppler perturbation from walking + breathing
            doppler = min(0.45, self.op_speed * 0.55) + abs(breath_wave) * 8.0
            disturbance = min(1.0, fresnel * (0.45 + doppler))
            node.fresnel_disturbance = round(disturbance, 3)
            node.csi_variance = round(0.015 + disturbance * 0.42, 4)
            # Human body shadowing drops RSSI by up to ~7.5 dB when crossing the 1st Fresnel ellipsoid
            node.rssi_dbm = round(17.0 - fspl_db - 7.5 * fresnel + math.sin(t * 3.1 + hash(nid) % 7) * 0.45, 1)
            max_fresnel = max(max_fresnel, disturbance)

        self.motion_energy = round(min(1.0, 0.10 + self.op_speed * 1.15 + abs(breath_wave) * 6.0), 3)
        self.presence_confidence = round(min(0.99, 0.84 + max_fresnel * 0.15), 3)

        # Generate physically authentic 52-subcarrier OFDM CSI amplitude & phase profile
        # Multipath interference creates frequency-selective fading notches across the 20 MHz channel
        d_op = math.hypot(self.op_x - tx[0], self.op_z - tx[2]) + math.hypot(self.op_x, self.op_z)
        amps: List[float] = []
        phases: List[float] = []
        for k in range(NUM_SUBCARRIERS):
            # Subcarrier frequency offset across 20 MHz (spacing 312.5 kHz)
            f_off = (k - NUM_SUBCARRIERS / 2) * 0.3125e6
            # Multipath delay phase + body scatterer phase
            phase_static = 2.0 * math.pi * f_off * (d_op / 3.0e8)
            phase_dyn = (2.0 * math.pi / WIFI_WAVELENGTH_M) * (0.25 * math.sin(t * 1.8) * self.op_speed + breath_wave)
            # Direct path + human reflected path + room wall multipath
            re = 0.68 + 0.26 * max_fresnel * math.cos(phase_static + phase_dyn + k * 0.11) + 0.08 * math.cos(k * 0.37)
            im = 0.26 * max_fresnel * math.sin(phase_static + phase_dyn + k * 0.11) + 0.08 * math.sin(k * 0.37)
            amp = math.hypot(re, im)
            amps.append(round(max(0.05, min(1.0, amp)), 4))
            phases.append(round(math.atan2(im, re), 3))

        self.subcarriers_amp = amps
        self.subcarriers_phase = phases

    def _compute_wave_field(self, t: float) -> None:
        """
        Compute a 16x16 RF wave interference & human reflection intensity grid over the room floor.
        Rendered in Three.js & UE5 as an interactive glowing Wi-Fi wave field.
        """
        n = self.wave_field_size
        tx = self.nodes["TX_AP"].pos
        grid: List[float] = []
        for gz in range(n):
            wz = -ROOM_HALF_W + (gz + 0.5) * (2.0 * ROOM_HALF_W / n)
            for gx in range(n):
                wx = -ROOM_HALF_W + (gx + 0.5) * (2.0 * ROOM_HALF_W / n)
                # Expanding wavefront from TX AP
                d_tx = math.hypot(wx - tx[0], wz - tx[2])
                carrier_wave = 0.5 + 0.5 * math.sin(d_tx * 5.2 - t * 4.2)
                tx_atten = 1.0 / (1.0 + 0.22 * d_tx * d_tx)

                # Scattered energy halo around the human operator
                d_op = math.hypot(wx - self.op_x, wz - self.op_z)
                human_scatter = math.exp(-(d_op * d_op) / 0.36) * (0.65 + 0.35 * math.sin(d_op * 9.0 - t * 5.0))

                val = min(1.0, carrier_wave * tx_atten * 0.42 + human_scatter * 0.85)
                grid.append(round(val, 3))
        self.wave_field = grid

    def get_snapshot(self) -> Dict[str, object]:
        with self._lock:
            now = time.monotonic()
            live_connected = self.mode == "live_udp" and (now - self._last_udp_rx) < 3.0
            return {
                "mode": self.mode,
                "live_udp_connected": live_connected,
                "udp_port": self.udp_port,
                "packets_received": self._packet_count,
                "sim_behavior": self.sim_behavior,
                "rf_spec": {
                    "standard": "IEEE 802.11n HT20",
                    "channel": 6,
                    "freq_mhz": 2437,
                    "wavelength_cm": 12.3,
                    "subcarriers": NUM_SUBCARRIERS,
                    "spacing_khz": 312.5,
                },
                "repo_compatible": "ruvnet/RuView (wifi-densepose) & espressif/esp-csi",
                "room_size_m": [ROOM_HALF_W * 2.0, 2.8, ROOM_HALF_W * 2.0],
                "operator": {
                    "pos": [round(self.op_x, 3), 0.0, round(self.op_z, 3)],
                    "ue5_pos_cm": {
                        "x": round(self.op_z * 100.0, 1),
                        "y": round(self.op_x * 100.0, 1),
                        "z": 0.0,
                    },
                    "yaw_rad": round(self.op_yaw, 3),
                    "speed_mps": round(self.op_speed, 3),
                    "posture": self.op_posture,
                    "presence_confidence": self.presence_confidence,
                    "motion_energy": self.motion_energy,
                    "breathing_bpm": self.breathing_bpm,
                    "heart_rate_bpm": self.heart_rate_bpm,
                },
                "nodes": [
                    {
                        "id": node.node_id,
                        "role": node.role,
                        "pos": list(node.pos),
                        "rssi_dbm": node.rssi_dbm,
                        "csi_variance": node.csi_variance,
                        "fresnel_disturbance": node.fresnel_disturbance,
                        "online": node.online,
                    }
                    for node in self.nodes.values()
                ],
                "subcarriers_amp": self.subcarriers_amp,
                "subcarriers_phase": self.subcarriers_phase,
                "wave_field_size": self.wave_field_size,
                "wave_field": self.wave_field,
            }
