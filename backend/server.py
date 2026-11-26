"""
Unified Digital Twin Core Hub (WebSocket + MJPEG Vision + Wi-Fi CSI + UE5 Bridge)
---------------------------------------------------------------------------------
Serves:
  - http://localhost:8765/                   -> 3D PBR Digital Twin Web UI
  - ws://localhost:8765/ws/twin              -> 30 Hz JSON Telemetry (Web UI & Unreal Engine 5!)
  - http://localhost:8765/api/camera/mjpeg   -> Live OpenCV Annotated ESP32-CAM Stream
  - http://localhost:8765/api/camera/frame.jpg -> Single JPEG Snapshot
  - http://localhost:8765/api/state          -> Current JSON Telemetry Snapshot
  - POST http://localhost:8765/api/command   -> Control Arm, Cubes, Camera, Wi-Fi CSI, ESP32
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import time
from pathlib import Path
from typing import Dict, List, Optional, Set

from aiohttp import WSMsgType, web

from esp32_bridge import ESP32ArmBridge
from kinematics import (
    ElectricalPhysicsModel,
    GRIPPER_CUBE_38MM_DEG,
    GRIPPER_OPEN_DEG,
    HOME_JOINTS,
    JOINT_LIMITS,
    L0_BASE_HEIGHT,
    L1_UPPER_ARM,
    L2_FOREARM,
    L3_GRIPPER_LEN,
    SmoothTrajectory,
    clamp,
    forward_kinematics,
    inverse_kinematics,
    to_ue5_cm,
)
from vision_engine import COLOR_PROFILES, CubeEntity, VisionEngine
from wifi_csi_bridge import WiFiCSIBridge


BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web_twin"


class DigitalTwinEngine:
    def __init__(self) -> None:
        self.mode: str = "auto_pick_place"  # "auto_pick_place" | "manual_joints" | "manual_ik"
        self.mission_phase: str = "SCANNING"
        self.mission_paused: bool = False
        self.sorted_count: int = 0
        self.cycle_count: int = 1
        self.speed_multiplier: float = 1.0

        self.joints: Dict[str, float] = dict(HOME_JOINTS)
        self.velocities: Dict[str, float] = {k: 0.0 for k in JOINT_LIMITS}
        self.trajectory = SmoothTrajectory()
        self.elec_model = ElectricalPhysicsModel()
        self.last_electrical: Dict[str, object] = {}

        self.cubes: List[CubeEntity] = []
        self.active_cube: Optional[CubeEntity] = None
        self.held_cube: Optional[CubeEntity] = None
        self._phase_wait: float = 0.0
        self._spawn_batch()

        self.vision = VisionEngine()
        self.csi = WiFiCSIBridge(udp_port=5005)
        self.csi.start_udp_listener()
        self.esp32 = ESP32ArmBridge()

        self.ws_clients: Set[web.WebSocketResponse] = set()
        self.ue5_clients: Set[web.WebSocketResponse] = set()
        self.logs: List[Dict[str, str]] = []
        self._log("SYSTEM", "Dijital İkiz çekirdeği başlatıldı (UE5 + Web PBR + OpenCV + Wi-Fi CSI).")

        self._last_vision_ts = 0.0
        self._start_ts = time.monotonic()

    def _log(self, tag: str, message: str) -> None:
        ts = time.strftime("%H:%M:%S")
        self.logs.append({"time": ts, "tag": tag, "msg": message})
        if len(self.logs) > 40:
            self.logs = self.logs[-40:]

    def _spawn_batch(self) -> None:
        """Place 4 fresh 38mm cubes inside the calibrated pickup bay."""
        slots = [
            ("RED", -0.068, 0.265, 14.0),
            ("BLUE", 0.064, 0.258, -18.0),
            ("GREEN", -0.062, 0.192, 26.0),
            ("YELLOW", 0.068, 0.188, -11.0),
        ]
        random.shuffle(slots)
        self.cubes = []
        for idx, (ckey, sx, sz, yaw) in enumerate(slots, start=1):
            jitter_x = random.uniform(-0.008, 0.008)
            jitter_z = random.uniform(-0.008, 0.008)
            size_m = 0.038
            self.cubes.append(
                CubeEntity(
                    cube_id=f"CUBE-{self.cycle_count:02d}{idx}",
                    color_key=ckey,
                    size_m=size_m,
                    pos=[round(sx + jitter_x, 4), size_m * 0.5, round(sz + jitter_z, 4)],
                    yaw_deg=round(yaw + random.uniform(-8, 8), 1),
                    status="WAITING",
                )
            )
        self.active_cube = None
        self.held_cube = None
        self.mission_phase = "SCANNING"
        self._phase_wait = 0.45

    def reset_workspace(self) -> None:
        self.cycle_count += 1
        self._spawn_batch()
        self.trajectory.move_to(self.joints, HOME_JOINTS, 0.75)
        self._log("MISSION", f"Yeni küp grubu (Tur #{self.cycle_count}) alma alanına yerleştirildi.")

    def _plan_ik_move(
        self,
        tx: float,
        ty: float,
        tz: float,
        yaw_deg: float,
        gripper_deg: float,
        duration: float,
    ) -> None:
        target_joints, _ = inverse_kinematics(
            tx, ty, tz, approach_pitch_deg=180.0, wrist_roll_deg=yaw_deg, gripper_deg=gripper_deg
        )
        self.trajectory.move_to(self.joints, target_joints, duration / max(0.3, self.speed_multiplier))

    def _update_mission(self, dt: float) -> None:
        if self.mission_paused or self.mode != "auto_pick_place":
            return

        if not self.trajectory.done:
            return

        if self._phase_wait > 0.0:
            self._phase_wait -= dt
            return

        if self.mission_phase == "SCANNING":
            waiting = [c for c in self.cubes if c.status == "WAITING"]
            if not waiting:
                self._log("MISSION", "Tüm küpler başarıyla ayrıştırıldı — yeni parti hazırlanıyor.")
                self.reset_workspace()
                return

            cube = waiting[0]
            cube.status = "LOCKED"
            self.active_cube = cube
            prof = COLOR_PROFILES[cube.color_key]
            self._log(
                "VISION",
                f"{cube.cube_id} ({prof['label_tr']}) tespit edildi → Hedef: {prof['zone']}",
            )
            self._plan_ik_move(cube.pos[0], 0.115, cube.pos[2], cube.yaw_deg, 76.0, 0.95)
            self.mission_phase = "APPROACH_ABOVE"

        elif self.mission_phase == "APPROACH_ABOVE" and self.active_cube:
            c = self.active_cube
            self._plan_ik_move(c.pos[0], c.size_m * 0.5 + 0.003, c.pos[2], c.yaw_deg, 76.0, 0.65)
            self.mission_phase = "DESCEND_PICK"

        elif self.mission_phase == "DESCEND_PICK" and self.active_cube:
            c = self.active_cube
            # Close gripper jaws flush around 38.0mm cube (exact 32.73 deg => 38.0mm jaw gap!)
            target = dict(self.joints)
            target["j6_gripper"] = GRIPPER_CUBE_38MM_DEG
            self.trajectory.move_to(self.joints, target, 0.35 / max(0.3, self.speed_multiplier))
            self.mission_phase = "GRIP_CLOSE"

        elif self.mission_phase == "GRIP_CLOSE" and self.active_cube:
            c = self.active_cube
            c.status = "IN_GRIPPER"
            self.held_cube = c
            self._log("ARM", f"{c.cube_id} kavrandı (kıskaç: 38.0 mm), kaldırma fazına geçiliyor.")
            self._plan_ik_move(c.pos[0], 0.135, c.pos[2], c.yaw_deg, GRIPPER_CUBE_38MM_DEG, 0.65)
            self.mission_phase = "LIFT_CUBE"

        elif self.mission_phase == "LIFT_CUBE" and self.active_cube:
            c = self.active_cube
            zx, _, zz = COLOR_PROFILES[c.color_key]["zone_pos"]
            self._plan_ik_move(zx, 0.135, zz, 0.0, GRIPPER_CUBE_38MM_DEG, 1.05)
            self.mission_phase = "TRANSIT_TO_ZONE"

        elif self.mission_phase == "TRANSIT_TO_ZONE" and self.active_cube:
            c = self.active_cube
            zx, _, zz = COLOR_PROFILES[c.color_key]["zone_pos"]
            self._plan_ik_move(zx, c.size_m * 0.5 + 0.002, zz, 0.0, GRIPPER_CUBE_38MM_DEG, 0.65)
            self.mission_phase = "DESCEND_DROP"

        elif self.mission_phase == "DESCEND_DROP" and self.active_cube:
            c = self.active_cube
            target = dict(self.joints)
            target["j6_gripper"] = GRIPPER_OPEN_DEG
            self.trajectory.move_to(self.joints, target, 0.32 / max(0.3, self.speed_multiplier))
            self.mission_phase = "GRIP_RELEASE"

        elif self.mission_phase == "GRIP_RELEASE" and self.active_cube:
            c = self.active_cube
            zx, _, zz = COLOR_PROFILES[c.color_key]["zone_pos"]
            c.pos = [zx, c.size_m * 0.5, zz]
            c.yaw_deg = 0.0
            c.status = "SORTED"
            self.held_cube = None
            self.sorted_count += 1
            zone_name = COLOR_PROFILES[c.color_key]["zone"]
            self._log("SORTED", f"{c.cube_id} → {zone_name} bölgesine bırakıldı (Toplam: {self.sorted_count}).")
            self._plan_ik_move(zx, 0.125, zz, 0.0, 78.0, 0.55)
            self.mission_phase = "RETRACT"

        elif self.mission_phase == "RETRACT":
            self.active_cube = None
            self.trajectory.move_to(self.joints, HOME_JOINTS, 0.72 / max(0.3, self.speed_multiplier))
            self.mission_phase = "SCANNING"
            self._phase_wait = 0.35

    def step(self, dt: float) -> None:
        # 1. Step trajectory & mission controller
        if self.mode == "auto_pick_place":
            self._update_mission(dt)
            if not self.trajectory.done:
                self.joints, self.velocities = self.trajectory.step(dt)
            else:
                self.velocities = {k: 0.0 for k in JOINT_LIMITS}
        else:
            if not self.trajectory.done:
                self.joints, self.velocities = self.trajectory.step(dt)
            else:
                self.velocities = {k: 0.0 for k in JOINT_LIMITS}

        # 2. Forward kinematics & attached cube tracking
        fk = forward_kinematics(self.joints)
        tip = fk["tip"]
        if self.held_cube is not None:
            self.held_cube.pos = [
                round(tip[0], 4),
                round(max(self.held_cube.size_m * 0.5, tip[1]), 4),
                round(tip[2], 4),
            ]
            # Keep cube yaw aligned with world gripper rotation
            self.held_cube.yaw_deg = round(self.joints["j1_base"] + self.joints["j5_wrist_roll"], 1)

        # 3. Step stateful electrical/thermal model & stream joint angles to physical ESP32
        carry_kg = 0.022 if self.held_cube is not None else 0.0
        self.last_electrical = self.elec_model.step(self.joints, self.velocities, carry_kg, dt)
        self.esp32.send_joints(self.joints)

        # 4. Step Wi-Fi CSI Room & Operator Engine
        self.csi.update(dt)

        # 5. Run OpenCV Vision Engine (~20 Hz)
        now = time.monotonic()
        if now - self._last_vision_ts >= 0.05:
            self._last_vision_ts = now
            active_id = self.active_cube.cube_id if self.active_cube else None
            self.vision.process_frame(self.cubes, tip, active_id)

    def handle_command(self, cmd: Dict[str, object]) -> Dict[str, object]:
        action = str(cmd.get("action", ""))

        if action == "set_mode":
            new_mode = str(cmd.get("mode", "auto_pick_place"))
            if new_mode in ("auto_pick_place", "manual_joints", "manual_ik"):
                self.mode = new_mode
                self._log("CONTROL", f"Kontrol modu değiştirildi: {new_mode}")
            return {"ok": True, "mode": self.mode}

        if action == "toggle_pause":
            self.mission_paused = not self.mission_paused
            self._log("MISSION", "Görev duraklatıldı." if self.mission_paused else "Görev devam ediyor.")
            return {"ok": True, "paused": self.mission_paused}

        if action == "set_speed":
            self.speed_multiplier = clamp(float(cmd.get("speed", 1.0)), 0.35, 2.2)
            return {"ok": True, "speed": self.speed_multiplier}

        if action == "reset_cubes":
            self.reset_workspace()
            return {"ok": True}

        if action == "go_home":
            self.mode = "manual_joints"
            self.held_cube = None
            self.trajectory.move_to(self.joints, HOME_JOINTS, 0.8)
            self._log("ARM", "Robot kol başlangıç (HOME) konumuna dönüyor.")
            return {"ok": True}

        if action == "set_joints":
            self.mode = "manual_joints"
            incoming = cmd.get("joints", {})
            if isinstance(incoming, dict):
                target = dict(self.joints)
                for k, (lo, hi) in JOINT_LIMITS.items():
                    if k in incoming:
                        target[k] = clamp(float(incoming[k]), lo, hi)
                self.trajectory.move_to(self.joints, target, 0.16)
            return {"ok": True}

        if action == "set_ik":
            self.mode = "manual_ik"
            tx = float(cmd.get("x", 0.0))
            ty = float(cmd.get("y", 0.08))
            tz = float(cmd.get("z", 0.22))
            grip = float(cmd.get("gripper", self.joints["j6_gripper"]))
            target_j, reachable = inverse_kinematics(tx, ty, tz, 180.0, 0.0, grip)
            self.trajectory.move_to(self.joints, target_j, 0.45)
            return {"ok": True, "reachable": reachable, "joints": target_j}

        if action == "set_camera":
            mode = str(cmd.get("source_mode", "synthetic"))
            url = cmd.get("esp32_cam_url")
            self.vision.set_source(mode, str(url) if url else None)
            self._log("CAMERA", f"Kamera kaynağı: {mode}")
            return {"ok": True}

        if action == "set_csi_mode":
            mode = str(cmd.get("mode", "simulated"))
            self.csi.set_mode(mode)
            self._log("WIFI_CSI", f"Wi-Fi CSI modu: {mode} (UDP:{self.csi.udp_port})")
            return {"ok": True}

        if action == "set_csi_behavior":
            beh = str(cmd.get("behavior", "orbit_observe"))
            self.csi.set_sim_behavior(beh)
            return {"ok": True}

        if action == "set_operator_pos":
            self.csi.set_manual_operator_pos(float(cmd.get("x", 0.3)), float(cmd.get("z", 1.2)))
            return {"ok": True}

        if action == "connect_esp32":
            port = str(cmd.get("port", ""))
            baud = int(cmd.get("baudrate", 115200))
            ok = self.esp32.connect(port, baud)
            self._log("ESP32", f"{port} bağlantısı {'başarılı' if ok else 'başarısız: ' + self.esp32.last_error}")
            return {"ok": ok, "error": self.esp32.last_error}

        if action == "disconnect_esp32":
            self.esp32.disconnect()
            self._log("ESP32", "ESP32 seri bağlantısı kapatıldı (Simülasyon Modu).")
            return {"ok": True}

        return {"ok": False, "error": f"Unknown action: {action}"}

    def build_telemetry_packet(self) -> Dict[str, object]:
        fk = forward_kinematics(self.joints)
        electrical = self.last_electrical or self.elec_model.step(self.joints, self.velocities, 0.0, 0.033)

        cubes_payload = []
        for c in self.cubes:
            prof = COLOR_PROFILES[c.color_key]
            cubes_payload.append({
                "id": c.cube_id,
                "color_key": c.color_key,
                "color_tr": prof["label_tr"],
                "hex": prof["hex"],
                "size_m": c.size_m,
                "pos": c.pos,
                "ue5_pos_cm": to_ue5_cm((c.pos[0], c.pos[1], c.pos[2])),
                "yaw_deg": c.yaw_deg,
                "status": c.status,
                "target_zone": prof["zone"],
            })

        zones_payload = [
            {
                "name": prof["zone"],
                "color_key": key,
                "color_tr": prof["label_tr"],
                "hex": prof["hex"],
                "pos": list(prof["zone_pos"]),
            }
            for key, prof in COLOR_PROFILES.items()
        ]

        return {
            "timestamp": round(time.time(), 3),
            "uptime_s": round(time.monotonic() - self._start_ts, 1),
            "system": {
                "mode": self.mode,
                "mission_phase": self.mission_phase,
                "paused": self.mission_paused,
                "speed_multiplier": self.speed_multiplier,
                "sorted_count": self.sorted_count,
                "cycle_count": self.cycle_count,
                "web_clients": len(self.ws_clients),
                "ue5_clients": len(self.ue5_clients),
            },
            "robot": {
                "links_m": {
                    "L0": L0_BASE_HEIGHT,
                    "L1": L1_UPPER_ARM,
                    "L2": L2_FOREARM,
                    "L3": L3_GRIPPER_LEN,
                },
                "joints_deg": {k: round(v, 2) for k, v in self.joints.items()},
                "fk_m": {k: [round(p, 4) for p in v] for k, v in fk.items()},
                "ue5_tip_cm": to_ue5_cm(fk["tip"]),
                "holding_cube_id": self.held_cube.cube_id if self.held_cube else None,
                "electrical": electrical,
            },
            "cubes": cubes_payload,
            "zones": zones_payload,
            "vision": self.vision.get_snapshot(),
            "wifi_csi": self.csi.get_snapshot(),
            "esp32": self.esp32.get_snapshot(),
            "logs": self.logs[-14:],
        }


async def create_app() -> web.Application:
    engine = DigitalTwinEngine()
    app = web.Application()
    app["engine"] = engine

    async def index_handler(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(WEB_DIR / "index.html")

    async def state_handler(_request: web.Request) -> web.Response:
        return web.json_response(engine.build_telemetry_packet())

    async def command_handler(request: web.Request) -> web.Response:
        body = await request.json()
        res = engine.handle_command(body)
        return web.json_response(res)

    async def virtual_cam_upload_handler(request: web.Request) -> web.Response:
        body = await request.read()
        ok = engine.vision.push_virtual_3d_jpeg(body)
        return web.json_response({"ok": ok})

    async def camera_frame_handler(_request: web.Request) -> web.Response:
        jpg = engine.vision.get_latest_jpeg()
        if not jpg:
            return web.Response(status=503, text="Camera frame warming up")
        return web.Response(body=jpg, content_type="image/jpeg", headers={"Cache-Control": "no-cache"})

    async def camera_mjpeg_handler(request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "multipart/x-mixed-replace; boundary=frame",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
            },
        )
        await response.prepare(request)
        try:
            while True:
                jpg = engine.vision.get_latest_jpeg()
                if jpg:
                    part = (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        + f"Content-Length: {len(jpg)}\r\n\r\n".encode("ascii")
                        + jpg
                        + b"\r\n"
                    )
                    await response.write(part)
                await asyncio.sleep(0.055)
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        return response

    async def ws_twin_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20.0)
        await ws.prepare(request)
        client_type = request.query.get("client", "web").lower()
        engine.ws_clients.add(ws)
        if client_type == "ue5":
            engine.ue5_clients.add(ws)
            engine._log("UE5", "Unreal Engine 5 Dijital İkiz istemcisi bağlandı!")

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if "action" in data:
                            resp = engine.handle_command(data)
                            await ws.send_json({"type": "ack", **resp})
                    except Exception:
                        pass
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            engine.ws_clients.discard(ws)
            if ws in engine.ue5_clients:
                engine.ue5_clients.discard(ws)
                engine._log("UE5", "Unreal Engine 5 bağlantısı ayrıldı.")
        return ws

    async def simulation_loop(app_ref: web.Application) -> None:
        eng: DigitalTwinEngine = app_ref["engine"]
        tick_hz = 30.0
        dt_target = 1.0 / tick_hz
        last = time.monotonic()

        while True:
            now = time.monotonic()
            dt = min(0.08, max(0.001, now - last))
            last = now

            eng.step(dt)

            if eng.ws_clients:
                payload = json.dumps(eng.build_telemetry_packet(), separators=(",", ":"))
                dead = []
                for ws in list(eng.ws_clients):
                    try:
                        await ws.send_str(payload)
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    eng.ws_clients.discard(ws)
                    eng.ue5_clients.discard(ws)

            elapsed = time.monotonic() - now
            await asyncio.sleep(max(0.004, dt_target - elapsed))

    async def start_bg(app_ref: web.Application) -> None:
        app_ref["sim_task"] = asyncio.create_task(simulation_loop(app_ref))

    async def cleanup_bg(app_ref: web.Application) -> None:
        app_ref["sim_task"].cancel()
        try:
            await app_ref["sim_task"]
        except asyncio.CancelledError:
            pass
        engine.csi.stop()
        engine.esp32.disconnect()

    app.on_startup.append(start_bg)
    app.on_cleanup.append(cleanup_bg)

    app.router.add_get("/", index_handler)
    app.router.add_get("/api/state", state_handler)
    app.router.add_post("/api/command", command_handler)
    app.router.add_post("/api/camera/virtual_frame", virtual_cam_upload_handler)
    app.router.add_get("/api/camera/frame.jpg", camera_frame_handler)
    app.router.add_get("/api/camera/mjpeg", camera_mjpeg_handler)
    app.router.add_get("/ws/twin", ws_twin_handler)
    app.router.add_static("/static", WEB_DIR)

    return app


if __name__ == "__main__":
    print("=" * 68)
    print("  ROBOT KOL DİJİTAL İKİZ + OPENCV + WI-FI CSI + UE5 TELEMETRİ HUB")
    print("  Web 3D PBR Arayüzü : http://localhost:8765")
    print("  UE5 WebSocket Ucu  : ws://localhost:8765/ws/twin?client=ue5")
    print("  ESP32-S3 CSI UDP   : 0.0.0.0:5005 (RuView / ESP-CSI uyumlu)")
    print("=" * 68)
    web.run_app(create_app(), host="127.0.0.1", port=8765, print=None)
