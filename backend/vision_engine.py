"""
ESP32-CAM & OpenCV Real-Time Cube Vision Analyzer (V2 — Exact Pinhole 3D Calibration)
-------------------------------------------------------------------------------------
Supports 3 camera sources with 100% consistent pinhole camera geometry:
  1. "synthetic" — Receives live 3D-rendered frames directly from the virtual OV2640
                   PerspectiveCamera mounted on the 3D ESP32-CAM gantry (showing real PBR
                   lighting, real shadows, and the real 3D robot arm moving in-frame!),
                   and runs the REAL OpenCV pipeline on those pixels!
                   (Includes calibrated fallback renderer when no browser is attached.)
  2. "esp32cam"  — Connects to an AI-Thinker ESP32-CAM MJPEG stream (http://<ip>:81/stream).
  3. "webcam"    — Connects to local PC/USB webcam (device index 0).

Pinhole Geometry (matches Three.js PerspectiveCamera at (0, 0.52, 0.22), FOV=56 deg, up=(0,0,-1)):
  - Camera height above workbench surface (Y=0): 0.520 m
  - Camera height above 38mm cube top face (Y=0.038): h = 0.482 m
  - Focal length (640x480): fy = fx = 240 / tan(28 deg) = 451.374 px
  - Scale at cube top plane: 936.46 px/m (0.9365 px/mm)
  - Image +X = World +X (Right), Image +Y = World +Z (Forward away from robot base)
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np


FRAME_W = 640
FRAME_H = 480

# Exact OV2640 3.6mm lens pinhole intrinsics matching our 3D gantry camera
CAM_POS = (0.0, 0.52, 0.22)
CAM_FOV_V_DEG = 56.0
FOCAL_PX = (FRAME_H * 0.5) / math.tan(math.radians(CAM_FOV_V_DEG * 0.5))  # 451.374 px
CUBE_TOP_Y = 0.038
H_TO_CUBE_TOP = CAM_POS[1] - CUBE_TOP_Y  # 0.482 m
PX_PER_M_TOP = FOCAL_PX / H_TO_CUBE_TOP  # 936.46 px/m


# Realistic 3D-printed filament profiles (38x38x38mm = 54.87 cm^3, ~25-35% gyroid infill + 3 walls)
COLOR_PROFILES = {
    "RED": {
        "label_tr": "Kırmızı",
        "bgr": (48, 54, 218),
        "hex": "#da3630",
        "zone": "ZONE-A",
        "zone_pos": (-0.20, 0.019, 0.12),
        "material": "PLA+ Kırmızı (%25 Gyroid)",
        "density_g_cm3": 0.40,  # ~22.0g for 38mm cube
        "hsv_ranges": [((0, 85, 65), (12, 255, 255)), ((166, 85, 65), (180, 255, 255))],
    },
    "BLUE": {
        "label_tr": "Mavi",
        "bgr": (228, 126, 38),
        "hex": "#267ee4",
        "zone": "ZONE-B",
        "zone_pos": (0.20, 0.019, 0.12),
        "material": "PETG Mavi (%30 Doluluk)",
        "density_g_cm3": 0.45,  # ~24.7g
        "hsv_ranges": [((96, 80, 60), (134, 255, 255))],
    },
    "GREEN": {
        "label_tr": "Yeşil",
        "bgr": (84, 188, 52),
        "hex": "#34bc54",
        "zone": "ZONE-C",
        "zone_pos": (-0.20, 0.019, 0.22),
        "material": "ABS Yeşil (%25 Doluluk)",
        "density_g_cm3": 0.35,  # ~19.2g
        "hsv_ranges": [((38, 65, 55), (86, 255, 255))],
    },
    "YELLOW": {
        "label_tr": "Sarı",
        "bgr": (38, 198, 232),
        "hex": "#e8c626",
        "zone": "ZONE-D",
        "zone_pos": (0.20, 0.019, 0.22),
        "material": "PLA Sarı (%20 Kalibrasyon)",
        "density_g_cm3": 0.37,  # ~20.3g
        "hsv_ranges": [((16, 85, 75), (36, 255, 255))],
    },
}


@dataclass
class CubeEntity:
    cube_id: str
    color_key: str
    size_m: float = 0.038
    pos: List[float] = field(default_factory=lambda: [0.0, 0.019, 0.22])
    yaw_deg: float = 12.0
    status: str = "WAITING"  # "WAITING" | "LOCKED" | "IN_GRIPPER" | "SORTED"
    detected: Optional[Dict[str, object]] = None


def world_to_pixel(wx: float, wz: float, wy: float = CUBE_TOP_Y) -> Tuple[int, int]:
    """Exact pinhole projection matching Three.js camera at (0, 0.52, 0.22), up=(0, 0, -1)."""
    h = max(0.08, CAM_POS[1] - wy)
    px = int(round(FRAME_W * 0.5 + ((wx - CAM_POS[0]) / h) * FOCAL_PX))
    py = int(round(FRAME_H * 0.5 + ((wz - CAM_POS[2]) / h) * FOCAL_PX))
    return px, py


def pixel_to_world(px: float, py: float, wy: float = CUBE_TOP_Y) -> Tuple[float, float]:
    """Back-project pixel (px, py) onto horizontal plane Y = wy."""
    h = max(0.08, CAM_POS[1] - wy)
    wx = CAM_POS[0] + ((px - FRAME_W * 0.5) / FOCAL_PX) * h
    wz = CAM_POS[2] + ((py - FRAME_H * 0.5) / FOCAL_PX) * h
    return wx, wz


def normalize_square_yaw(angle_deg: float) -> float:
    """Normalize OpenCV minAreaRect angle cleanly into [-45, +45] deg for square cubes."""
    a = ((angle_deg + 45.0) % 90.0) - 45.0
    return round(a, 1)


class VisionEngine:
    def __init__(self) -> None:
        self.source_mode: str = "synthetic"  # "synthetic" | "esp32cam" | "webcam"
        self.esp32_cam_url: str = "http://192.168.1.50:81/stream"
        self.fps: float = 20.0
        self.detections: List[Dict[str, object]] = []
        self.active_cube_info: Optional[Dict[str, object]] = None
        self.camera_connected: bool = True
        self.using_live_3d_cam: bool = False

        self._latest_jpeg: bytes = b""
        self._virtual_3d_frame: Optional[np.ndarray] = None
        self._virtual_3d_ts: float = 0.0

        self._cap: Optional[cv2.VideoCapture] = None
        self._raw_ext_frame: Optional[np.ndarray] = None
        self._ext_thread: Optional[threading.Thread] = None
        self._ext_running = False
        self._lock = threading.Lock()
        self._frame_idx = 0
        self._last_fps_ts = time.monotonic()
        self._fps_counter = 0

        self._bg_template = self._build_workbench_template()

    def push_virtual_3d_jpeg(self, jpeg_bytes: bytes) -> bool:
        """Accept photorealistic frame rendered by the 3D scene's virtual ESP32-CAM lens."""
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return False
        if img.shape[1] != FRAME_W or img.shape[0] != FRAME_H:
            img = cv2.resize(img, (FRAME_W, FRAME_H), interpolation=cv2.INTER_LINEAR)
        with self._lock:
            self._virtual_3d_frame = img
            self._virtual_3d_ts = time.monotonic()
        return True

    def _build_workbench_template(self) -> np.ndarray:
        """Fallback calibrated workbench render used before a browser 3D camera connects."""
        img = np.full((FRAME_H, FRAME_W, 3), (26, 29, 34), dtype=np.uint8)
        yy, xx = np.mgrid[0:FRAME_H, 0:FRAME_W].astype(np.float32)
        dist = np.hypot((xx - FRAME_W * 0.5) / (FRAME_W * 0.65), (yy - FRAME_H * 0.5) / (FRAME_H * 0.65))
        vignette = np.clip(1.16 - 0.38 * (dist ** 2), 0.70, 1.16)
        img = np.clip(img.astype(np.float32) * vignette[:, :, None], 0, 255).astype(np.uint8)

        for x_cm in range(-32, 33, 2):
            px, _ = world_to_pixel(x_cm / 100.0, 0.22, 0.0)
            col = (44, 49, 56) if x_cm % 10 == 0 else (33, 36, 42)
            if 0 <= px < FRAME_W:
                cv2.line(img, (px, 0), (px, FRAME_H), col, 1)
        for z_cm in range(-2, 46, 2):
            _, py = world_to_pixel(0.0, z_cm / 100.0, 0.0)
            col = (44, 49, 56) if z_cm % 10 == 0 else (33, 36, 42)
            if 0 <= py < FRAME_H:
                cv2.line(img, (0, py), (FRAME_W, py), col, 1)

        p1 = world_to_pixel(-0.11, 0.16, 0.0)
        p2 = world_to_pixel(0.11, 0.31, 0.0)
        cv2.rectangle(img, p1, p2, (72, 102, 125), 1, cv2.LINE_AA)
        for prof in COLOR_PROFILES.values():
            zx, _, zz = prof["zone_pos"]
            c1 = world_to_pixel(zx - 0.038, zz - 0.038, 0.0)
            c2 = world_to_pixel(zx + 0.038, zz + 0.038, 0.0)
            bgr = prof["bgr"]
            cv2.rectangle(img, c1, c2, (bgr[0] // 3, bgr[1] // 3, bgr[2] // 3), 1, cv2.LINE_AA)
        return img

    def set_source(self, mode: str, esp32_url: Optional[str] = None) -> None:
        if esp32_url:
            self.esp32_cam_url = esp32_url.strip()
        if mode not in ("synthetic", "esp32cam", "webcam"):
            return

        self._stop_external_capture()
        self.source_mode = mode
        if mode in ("esp32cam", "webcam"):
            self._start_external_capture()
        else:
            self.camera_connected = True

    def _stop_external_capture(self) -> None:
        self._ext_running = False
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
        self._raw_ext_frame = None

    def _start_external_capture(self) -> None:
        self._ext_running = True
        self._ext_thread = threading.Thread(target=self._external_capture_loop, daemon=True)
        self._ext_thread.start()

    def _external_capture_loop(self) -> None:
        target = 0 if self.source_mode == "webcam" else self.esp32_cam_url
        while self._ext_running:
            cap = cv2.VideoCapture(target)
            if not cap.isOpened():
                self.camera_connected = False
                time.sleep(1.5)
                continue
            self._cap = cap
            self.camera_connected = True
            while self._ext_running and cap.isOpened():
                ok, frame = cap.read()
                if not ok or frame is None:
                    self.camera_connected = False
                    break
                resized = cv2.resize(frame, (FRAME_W, FRAME_H))
                with self._lock:
                    self._raw_ext_frame = resized
            cap.release()
            time.sleep(1.0)

    def _render_fallback_frame(self, cubes: List[CubeEntity]) -> np.ndarray:
        frame = self._bg_template.copy()
        for cube in cubes:
            top_y = cube.pos[1] + cube.size_m * 0.5
            cx, cy = world_to_pixel(cube.pos[0], cube.pos[2], top_y)
            px_size = (cube.size_m / max(0.08, CAM_POS[1] - top_y)) * FOCAL_PX
            rect = ((float(cx), float(cy)), (px_size, px_size), cube.yaw_deg)
            box = cv2.boxPoints(rect).astype(np.int32)
            prof = COLOR_PROFILES[cube.color_key]
            cv2.fillConvexPoly(frame, box, prof["bgr"], cv2.LINE_AA)
            cv2.polylines(frame, [box], True, (24, 24, 28), 1, cv2.LINE_AA)
        return frame

    def process_frame(
        self,
        cubes: List[CubeEntity],
        tip_pos: Tuple[float, float, float],
        active_cube_id: Optional[str],
    ) -> List[Dict[str, object]]:
        self._frame_idx += 1
        now = time.monotonic()
        self._fps_counter += 1
        if now - self._last_fps_ts >= 1.0:
            self.fps = round(self._fps_counter / (now - self._last_fps_ts), 1)
            self._fps_counter = 0
            self._last_fps_ts = now

        self.using_live_3d_cam = False
        if self.source_mode == "synthetic":
            with self._lock:
                if self._virtual_3d_frame is not None and (now - self._virtual_3d_ts) < 2.0:
                    raw_frame = self._virtual_3d_frame.copy()
                    self.using_live_3d_cam = True
                else:
                    raw_frame = self._render_fallback_frame(cubes)
            self.camera_connected = True
        else:
            with self._lock:
                ext = None if self._raw_ext_frame is None else self._raw_ext_frame.copy()
            if ext is None:
                raw_frame = self._render_fallback_frame(cubes)
                cv2.putText(
                    raw_frame,
                    f"BEKLENIYOR: {self.source_mode.upper()} ({self.esp32_cam_url})",
                    (16, FRAME_H - 18),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.44,
                    (70, 190, 255),
                    1,
                    cv2.LINE_AA,
                )
            else:
                raw_frame = ext

        # --- REAL OPENCV COMPUTER VISION PIPELINE ---
        blurred = cv2.GaussianBlur(raw_frame, (5, 5), 0)
        hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

        annotated = raw_frame.copy()
        detections: List[Dict[str, object]] = []
        matched_ids = set()

        for color_key, prof in COLOR_PROFILES.items():
            mask = np.zeros((FRAME_H, FRAME_W), dtype=np.uint8)
            for lo, hi in prof["hsv_ranges"]:
                mask = cv2.bitwise_or(mask, cv2.inRange(hsv, np.array(lo), np.array(hi)))

            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                area_px = cv2.contourArea(cnt)
                if area_px < 420 or area_px > 16000:
                    continue

                rect = cv2.minAreaRect(cnt)
                (cx, cy), (rw, rh), raw_angle = rect
                if rw < 16 or rh < 16:
                    continue

                # Ignore robot base ring / outer frame reflections outside the workbench mat
                if cy < 48 or cy > FRAME_H - 14 or cx < 24 or cx > FRAME_W - 24:
                    continue

                aspect = min(rw, rh) / max(rw, rh)
                if aspect < 0.52:
                    continue

                # Exclude blue anodized servo housings near the robot arm base/body
                # (when viewing live 3D camera, check distance to known workbench zone / cubes)
                wx, wz = pixel_to_world(cx, cy, CUBE_TOP_Y)
                if color_key == "BLUE" and wz < 0.085 and abs(wx) < 0.14:
                    continue

                # Match to nearest logical cube entity for height parallax correction & ID tracking
                matched_cube: Optional[CubeEntity] = None
                best_dist = 0.095
                for c in cubes:
                    if c.color_key == color_key and c.cube_id not in matched_ids:
                        d = math.hypot(c.pos[0] - wx, c.pos[2] - wz)
                        if d < best_dist:
                            best_dist = d
                            matched_cube = c

                # If live 3D camera is active, adjust pinhole scale using actual cube elevation when lifted!
                top_y = (matched_cube.pos[1] + matched_cube.size_m * 0.5) if matched_cube else CUBE_TOP_Y
                h_cam = max(0.10, CAM_POS[1] - top_y)
                px_per_mm = (FOCAL_PX / h_cam) / 1000.0
                wx, wz = pixel_to_world(cx, cy, top_y)

                width_mm = round(rw / px_per_mm, 1)
                depth_mm = round(rh / px_per_mm, 1)
                height_mm = round((width_mm + depth_mm) * 0.5, 1)
                # Filter out tiny reflections or huge non-cube regions
                if width_mm < 22.0 or width_mm > 65.0 or depth_mm < 22.0 or depth_mm > 65.0:
                    continue

                area_cm2 = round((width_mm * depth_mm) / 100.0, 2)
                volume_cm3 = round((width_mm * depth_mm * height_mm) / 1000.0, 2)
                weight_g = round(volume_cm3 * prof["density_g_cm3"], 1)

                cnt_mask = np.zeros((FRAME_H, FRAME_W), dtype=np.uint8)
                cv2.drawContours(cnt_mask, [cnt], -1, 255, -1)
                mean_bgr = cv2.mean(raw_frame, mask=cnt_mask)[:3]
                mean_hsv = cv2.mean(hsv, mask=cnt_mask)[:3]

                cube_id = matched_cube.cube_id if matched_cube else f"CV-{color_key[:2]}-{int(cx)}"
                if matched_cube:
                    matched_ids.add(matched_cube.cube_id)
                wy = matched_cube.pos[1] if matched_cube else (height_mm / 2000.0)
                status = matched_cube.status if matched_cube else "DETECTED"

                rect_fill = min(1.0, area_px / max(1.0, rw * rh))
                confidence = round(min(99.4, (0.62 * rect_fill + 0.38 * aspect) * 100.0), 1)
                yaw_norm = normalize_square_yaw(float(raw_angle))

                det = {
                    "id": cube_id,
                    "color_key": color_key,
                    "color_tr": prof["label_tr"],
                    "hex": prof["hex"],
                    "rgb": [int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])],
                    "hsv": [int(mean_hsv[0]), int(mean_hsv[1]), int(mean_hsv[2])],
                    "size_mm": [width_mm, depth_mm, height_mm],
                    "area_cm2": area_cm2,
                    "volume_cm3": volume_cm3,
                    "est_weight_g": weight_g,
                    "material": prof["material"],
                    "world_pos_m": [round(wx, 4), round(wy, 4), round(wz, 4)],
                    "pixel_pos": [int(cx), int(cy)],
                    "yaw_deg": yaw_norm,
                    "confidence_pct": confidence,
                    "target_zone": prof["zone"],
                    "status": status,
                    "is_active_target": cube_id == active_cube_id,
                }
                detections.append(det)

                # --- Precision OpenCV Engineering HUD Overlay ---
                box = cv2.boxPoints(rect).astype(np.int32)
                is_target = cube_id == active_cube_id
                outline_col = (0, 245, 212) if is_target else prof["bgr"]
                cv2.polylines(annotated, [box], True, outline_col, 2 if is_target else 1, cv2.LINE_AA)

                icx, icy = int(cx), int(cy)
                cv2.drawMarker(annotated, (icx, icy), (245, 250, 255), cv2.MARKER_CROSS, 9, 1, cv2.LINE_AA)

                if is_target:
                    r = int(max(rw, rh) * 0.72)
                    for sx, sy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                        px0, py0 = icx + sx * r, icy + sy * r
                        cv2.line(annotated, (px0, py0), (px0 - sx * 9, py0), (0, 245, 212), 2)
                        cv2.line(annotated, (px0, py0), (px0, py0 - sy * 9), (0, 245, 212), 2)

                label = f"{cube_id} | {width_mm:.0f}x{depth_mm:.0f}mm | {confidence:.0f}%"
                ty = max(36, icy - int(rh * 0.68) - 5)
                tx = max(6, min(FRAME_W - 180, icx - 62))
                cv2.rectangle(annotated, (tx - 3, ty - 12), (tx + 168, ty + 4), (10, 14, 20), -1)
                cv2.putText(annotated, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.36, outline_col, 1, cv2.LINE_AA)

        # If the gripper physically occludes the held cube from overhead camera view,
        # fuse with live Robot Forward Kinematics (standard industrial vision-kinematic fusion!)
        if active_cube_id and not any(d["id"] == active_cube_id for d in detections):
            c = next((x for x in cubes if x.cube_id == active_cube_id), None)
            if c is not None:
                prof = COLOR_PROFILES[c.color_key]
                vol = round((c.size_m * 100.0) ** 3, 2)
                fused = {
                    "id": c.cube_id,
                    "color_key": c.color_key,
                    "color_tr": prof["label_tr"],
                    "hex": prof["hex"],
                    "rgb": [prof["bgr"][2], prof["bgr"][1], prof["bgr"][0]],
                    "hsv": [0, 180, 210],
                    "size_mm": [38.0, 38.0, 38.0],
                    "area_cm2": 14.44,
                    "volume_cm3": vol,
                    "est_weight_g": round(vol * prof["density_g_cm3"], 1),
                    "material": prof["material"],
                    "world_pos_m": [round(c.pos[0], 4), round(c.pos[1], 4), round(c.pos[2], 4)],
                    "pixel_pos": list(world_to_pixel(c.pos[0], c.pos[2], c.pos[1] + 0.019)),
                    "yaw_deg": normalize_square_yaw(c.yaw_deg),
                    "confidence_pct": 94.0,
                    "target_zone": prof["zone"],
                    "status": f"{c.status} (FK FUSION)",
                    "is_active_target": True,
                }
                detections.append(fused)
                gx, gy = fused["pixel_pos"]
                cv2.circle(annotated, (gx, gy), 24, (0, 245, 212), 1, cv2.LINE_AA)
                cv2.putText(
                    annotated,
                    f"FK-LOCKED: {c.cube_id}",
                    (max(6, gx - 52), max(40, gy - 28)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.38,
                    (0, 245, 212),
                    1,
                    cv2.LINE_AA,
                )

        # Clean OV2640 Camera Status Header Bar
        cv2.rectangle(annotated, (0, 0), (FRAME_W, 24), (10, 14, 20), -1)
        src_tag = (
            "3D OV2640 LENS" if self.using_live_3d_cam
            else ("VIRTUAL CAM" if self.source_mode == "synthetic" else self.source_mode.upper())
        )
        header = f"ESP32-CAM [{src_tag}]  |  640x480  |  {self.fps:.1f} FPS  |  OPENCV: {len(detections)}"
        cv2.putText(annotated, header, (10, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.41, (148, 238, 232), 1, cv2.LINE_AA)

        ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        if ok:
            with self._lock:
                self._latest_jpeg = buf.tobytes()

        self.detections = detections
        active = next((d for d in detections if d["is_active_target"]), None)
        self.active_cube_info = active or (detections[0] if detections else None)
        return detections

    def get_latest_jpeg(self) -> bytes:
        with self._lock:
            return self._latest_jpeg

    def get_snapshot(self) -> Dict[str, object]:
        return {
            "source_mode": self.source_mode,
            "using_live_3d_cam": self.using_live_3d_cam,
            "esp32_cam_url": self.esp32_cam_url,
            "camera_connected": self.camera_connected,
            "fps": self.fps,
            "resolution": [FRAME_W, FRAME_H],
            "detected_count": len(self.detections),
            "active_cube": self.active_cube_info,
            "detections": self.detections,
        }
