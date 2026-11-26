"""
ESP32 Robotic Arm Hardware Bridge (USB Serial + Wi-Fi Ready)
------------------------------------------------------------
Streams 6-DOF joint angle commands to the physical ESP32 servo controller
and parses live telemetry (reported joint angles, servo bus voltage/current, RSSI)
back into the Digital Twin.

When no physical ESP32 is connected, operates transparently in Simulation Mode.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Dict, List, Optional

try:
    import serial
    import serial.tools.list_ports
except ImportError:  # pragma: no cover
    serial = None


class ESP32ArmBridge:
    def __init__(self) -> None:
        self.connected: bool = False
        self.port: str = ""
        self.baudrate: int = 115200
        self.last_error: str = ""
        self.hw_telemetry: Optional[Dict[str, object]] = None
        self.packets_sent: int = 0
        self.packets_received: int = 0

        self._ser = None
        self._running = False
        self._rx_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._last_tx_ts = 0.0

    def list_ports(self) -> List[Dict[str, str]]:
        if serial is None:
            return []
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({
                "device": p.device,
                "description": p.description or "",
                "hwid": p.hwid or "",
            })
        return ports

    def connect(self, port: str, baudrate: int = 115200) -> bool:
        self.disconnect()
        if serial is None:
            self.last_error = "pyserial yüklü değil"
            return False
        try:
            ser = serial.Serial(port, baudrate=baudrate, timeout=0.1)
            self._ser = ser
            self.port = port
            self.baudrate = baudrate
            self.connected = True
            self.last_error = ""
            self._running = True
            self._rx_thread = threading.Thread(target=self._rx_loop, daemon=True)
            self._rx_thread.start()
            return True
        except Exception as exc:
            self.last_error = str(exc)
            self.connected = False
            return False

    def disconnect(self) -> None:
        self._running = False
        self.connected = False
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
            self._ser = None

    def send_joints(self, joints: Dict[str, float]) -> None:
        """Throttle serial updates to ~40 Hz to keep ESP32 UART buffer clean."""
        if not self.connected or self._ser is None:
            return
        now = time.monotonic()
        if now - self._last_tx_ts < 0.025:
            return
        self._last_tx_ts = now

        payload = {
            "cmd": "SET_JOINTS",
            "j": [
                round(joints["j1_base"], 1),
                round(joints["j2_shoulder"], 1),
                round(joints["j3_elbow"], 1),
                round(joints["j4_wrist_pitch"], 1),
                round(joints["j5_wrist_roll"], 1),
                round(joints["j6_gripper"], 1),
            ],
        }
        line = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        try:
            with self._lock:
                self._ser.write(line)
                self.packets_sent += 1
        except Exception as exc:
            self.last_error = str(exc)
            self.disconnect()

    def _rx_loop(self) -> None:
        while self._running and self._ser is not None:
            try:
                raw = self._ser.readline()
                if not raw:
                    continue
                text = raw.decode("utf-8", errors="ignore").strip()
                if not text.startswith("{"):
                    continue
                data = json.loads(text)
                with self._lock:
                    self.hw_telemetry = data
                    self.packets_received += 1
            except Exception:
                continue

    def get_snapshot(self) -> Dict[str, object]:
        with self._lock:
            return {
                "connected": self.connected,
                "mode": "HARDWARE_SERIAL" if self.connected else "SIMULATION",
                "port": self.port,
                "baudrate": self.baudrate,
                "packets_sent": self.packets_sent,
                "packets_received": self.packets_received,
                "last_error": self.last_error,
                "hw_telemetry": self.hw_telemetry,
                "available_ports": self.list_ports(),
            }
