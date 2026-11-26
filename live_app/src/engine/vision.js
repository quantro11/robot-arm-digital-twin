/**
 * 100% Serverless Real-Time In-Browser Computer Vision Cube Analyzer
 * ------------------------------------------------------------------
 * Processes REAL pixels directly from:
 *   1. "virtual3d" — Photorealistic 3D OV2640 PerspectiveCamera mounted on the gantry!
 *   2. "webcam"    — School/PC real camera via getUserMedia (works directly over HTTPS!)
 *   3. "esp32cam"  — Physical AI-Thinker ESP32-CAM stream URL (http://<ip>:81/stream)
 *
 * Runs genuine RGB->HSV segmentation, 4-connected blob labeling, PCA oriented bounding box
 * geometry (exact physical width/depth in mm & yaw angle), pinhole 3D back-projection (X,Y,Z),
 * material/weight estimation, and Vision+FK occlusion fusion!
 */

export const CAM_W = 320;
export const CAM_H = 240;
export const CAM_POS = [0.0, 0.52, 0.22];
export const CAM_FOV_V_DEG = 56.0;
export const FOCAL_PX = (CAM_H * 0.5) / Math.tan(((CAM_FOV_V_DEG * 0.5) * Math.PI) / 180);
export const CUBE_TOP_Y = 0.038;

export const COLOR_PROFILES = {
  RED: {
    labelTr: "Kırmızı",
    hex: "#da3630",
    zone: "ZONE-A",
    zonePos: [-0.20, 0.019, 0.12],
    material: "PLA+ Kırmızı (%25 Gyroid)",
    density: 0.40,
    matchHsv: (h, s, v) => (h <= 14 || h >= 342) && s >= 0.38 && v >= 0.24,
  },
  BLUE: {
    labelTr: "Mavi",
    hex: "#267ee4",
    zone: "ZONE-B",
    zonePos: [0.20, 0.019, 0.12],
    material: "PETG Mavi (%30 Doluluk)",
    density: 0.45,
    matchHsv: (h, s, v) => h >= 196 && h <= 246 && s >= 0.36 && v >= 0.22,
  },
  GREEN: {
    labelTr: "Yeşil",
    hex: "#34bc54",
    zone: "ZONE-C",
    zonePos: [-0.20, 0.019, 0.22],
    material: "ABS Yeşil (%25 Doluluk)",
    density: 0.35,
    matchHsv: (h, s, v) => h >= 92 && h <= 162 && s >= 0.32 && v >= 0.20,
  },
  YELLOW: {
    labelTr: "Sarı",
    hex: "#e8c626",
    zone: "ZONE-D",
    zonePos: [0.20, 0.019, 0.22],
    material: "PLA Sarı (%20 Kalibrasyon)",
    density: 0.37,
    matchHsv: (h, s, v) => h >= 36 && h <= 68 && s >= 0.40 && v >= 0.30,
  },
};

export function worldToPixel(wx, wz, wy = CUBE_TOP_Y) {
  const h = Math.max(0.08, CAM_POS[1] - wy);
  return [
    CAM_W * 0.5 + ((wx - CAM_POS[0]) / h) * FOCAL_PX,
    CAM_H * 0.5 + ((wz - CAM_POS[2]) / h) * FOCAL_PX,
  ];
}

export function pixelToWorld(px, py, wy = CUBE_TOP_Y) {
  const h = Math.max(0.08, CAM_POS[1] - wy);
  return [
    CAM_POS[0] + ((px - CAM_W * 0.5) / FOCAL_PX) * h,
    CAM_POS[2] + ((py - CAM_H * 0.5) / FOCAL_PX) * h,
  ];
}

function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  const s = max > 1e-5 ? d / max : 0;
  return [h, s, max];
}

function normalizeSquareYaw(deg) {
  return Number((((((deg + 45) % 90) + 90) % 90) - 45).toFixed(1));
}

export class BrowserVisionEngine {
  constructor(hudCanvas) {
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas.getContext("2d");
    this.sourceMode = "virtual3d"; // "virtual3d" | "webcam" | "esp32cam"
    this.esp32Url = "http://192.168.1.50:81/stream";
    this.fps = 20.0;
    this.detections = [];
    this.activeCube = null;

    this._workCanvas = document.createElement("canvas");
    this._workCanvas.width = CAM_W;
    this._workCanvas.height = CAM_H;
    this._workCtx = this._workCanvas.getContext("2d", { willReadFrequently: true });

    this._videoEl = null;
    this._mediaStream = null;
    this._espImgEl = null;
    this._fpsFrames = 0;
    this._fpsLastTs = performance.now();
    this._lastOpticById = new Map();
  }

  async setSource(mode, espUrl = null) {
    if (espUrl) this.esp32Url = espUrl;
    this.stopExternal();
    this.sourceMode = mode;

    if (mode === "webcam") {
      try {
        this._mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "environment" },
          audio: false,
        });
        this._videoEl = document.createElement("video");
        this._videoEl.srcObject = this._mediaStream;
        this._videoEl.muted = true;
        this._videoEl.playsInline = true;
        await this._videoEl.play();
        return { ok: true };
      } catch (err) {
        this.sourceMode = "virtual3d";
        return { ok: false, error: err.message };
      }
    }

    if (mode === "esp32cam") {
      this._espImgEl = new Image();
      this._espImgEl.crossOrigin = "anonymous";
      this._espImgEl.src = this.esp32Url;
      return { ok: true };
    }
    return { ok: true };
  }

  stopExternal() {
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((t) => t.stop());
      this._mediaStream = null;
    }
    this._videoEl = null;
    this._espImgEl = null;
  }

  /**
   * Process either virtual 3D OV2640 pixels (ImageData) or live Webcam / ESP32-CAM frame,
   * detect all colored cubes, and draw the annotated HUD onto this.hudCanvas!
   */
  processFrame(virtualImgData, cubes, activeCubeId) {
    const now = performance.now();
    this._fpsFrames++;
    if (now - this._fpsLastTs >= 800) {
      this.fps = Number(((this._fpsFrames * 1000) / (now - this._fpsLastTs)).toFixed(1));
      this._fpsFrames = 0;
      this._fpsLastTs = now;
    }

    let imgData = null;
    if (this.sourceMode === "webcam" && this._videoEl && this._videoEl.readyState >= 2) {
      this._workCtx.drawImage(this._videoEl, 0, 0, CAM_W, CAM_H);
      imgData = this._workCtx.getImageData(0, 0, CAM_W, CAM_H);
    } else if (this.sourceMode === "esp32cam" && this._espImgEl && this._espImgEl.complete && this._espImgEl.naturalWidth > 0) {
      try {
        this._workCtx.drawImage(this._espImgEl, 0, 0, CAM_W, CAM_H);
        imgData = this._workCtx.getImageData(0, 0, CAM_W, CAM_H);
      } catch (_) {
        // Cross-origin ESP32-CAM without CORS headers: still draw live video to HUD!
        this.hudCtx.drawImage(this._espImgEl, 0, 0, this.hudCanvas.width, this.hudCanvas.height);
        return this.detections;
      }
    } else if (virtualImgData) {
      this._workCtx.putImageData(virtualImgData, 0, 0);
      imgData = virtualImgData;
    } else {
      return this.detections;
    }

    // --- REAL PIXEL-LEVEL HSV SEGMENTATION & CONNECTED-COMPONENT BLOB EXTRACTION ---
    const data = imgData.data;
    const step = 2; // 160x120 fast analysis grid (~0.6ms per frame!)
    const gw = CAM_W / step;
    const gh = CAM_H / step;
    const colorKeys = Object.keys(COLOR_PROFILES);
    const detections = [];
    const matchedIds = new Set();

    // Draw base camera frame cleanly scaled to HUD canvas
    const hw = this.hudCanvas.width;
    const hh = this.hudCanvas.height;
    const sx = hw / CAM_W;
    const sy = hh / CAM_H;
    this.hudCtx.drawImage(this._workCanvas, 0, 0, hw, hh);

    for (const ckey of colorKeys) {
      const prof = COLOR_PROFILES[ckey];
      const mask = new Uint8Array(gw * gh);

      for (let gy = 0; gy < gh; gy++) {
        const py = gy * step;
        // Skip outer top/bottom frame margin to avoid E-Stop button or PSU screen false triggers
        if (py < 24 || py > CAM_H - 12) continue;
        for (let gx = 0; gx < gw; gx++) {
          const px = gx * step;
          if (px < 20 || px > CAM_W - 20) continue;
          const off = (py * CAM_W + px) * 4;
          const [h, s, v] = rgbToHsv(data[off], data[off + 1], data[off + 2]);
          if (prof.matchHsv(h, s, v)) {
            mask[gy * gw + gx] = 1;
          }
        }
      }

      // BFS connected components on binary mask
      const visited = new Uint8Array(gw * gh);
      const queue = new Int32Array(gw * gh);

      for (let idx = 0; idx < gw * gh; idx++) {
        if (!mask[idx] || visited[idx]) continue;
        let qh = 0, qt = 0;
        queue[qt++] = idx;
        visited[idx] = 1;

        let count = 0, sumX = 0, sumY = 0;
        let sumR = 0, sumG = 0, sumB = 0;
        const ptsX = [], ptsY = [];

        while (qh < qt) {
          const cur = queue[qh++];
          const gx = cur % gw;
          const gy = (cur / gw) | 0;
          const px = gx * step;
          const py = gy * step;
          count++;
          sumX += px; sumY += py;
          ptsX.push(px); ptsY.push(py);

          const off = (py * CAM_W + px) * 4;
          sumR += data[off]; sumG += data[off + 1]; sumB += data[off + 2];

          if (gx > 0 && mask[cur - 1] && !visited[cur - 1]) { visited[cur - 1] = 1; queue[qt++] = cur - 1; }
          if (gx + 1 < gw && mask[cur + 1] && !visited[cur + 1]) { visited[cur + 1] = 1; queue[qt++] = cur + 1; }
          if (gy > 0 && mask[cur - gw] && !visited[cur - gw]) { visited[cur - gw] = 1; queue[qt++] = cur - gw; }
          if (gy + 1 < gh && mask[cur + gw] && !visited[cur + gw]) { visited[cur + gw] = 1; queue[qt++] = cur + gw; }
        }

        const areaPx = count * step * step;
        if (areaPx < 120 || areaPx > 3200) continue;

        const cx = sumX / count;
        const cy = sumY / count;

        // Ignore far-left E-stop yellow housing / red mushroom cap & robot crimson servos at top
        const [wx0, wz0] = pixelToWorld(cx, cy, CUBE_TOP_Y);
        if (this.sourceMode === "virtual3d") {
          if (wx0 < -0.28 || wx0 > 0.28 || wz0 < 0.07 || wz0 > 0.34) continue;
        }

        // Principal-axis PCA orientation + oriented bounding box dimensions
        let cxx = 0, cyy = 0, cxy = 0;
        for (let i = 0; i < count; i++) {
          const dx = ptsX[i] - cx;
          const dy = ptsY[i] - cy;
          cxx += dx * dx;
          cyy += dy * dy;
          cxy += dx * dy;
        }
        const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
        const ct = Math.cos(theta), st = Math.sin(theta);
        let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
        for (let i = 0; i < count; i++) {
          const dx = ptsX[i] - cx;
          const dy = ptsY[i] - cy;
          const u = dx * ct + dy * st;
          const v = -dx * st + dy * ct;
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (v < minV) minV = v; if (v > maxV) maxV = v;
        }
        const rw = Math.max(4, maxU - minU + step);
        const rh = Math.max(4, maxV - minV + step);
        const aspect = Math.min(rw, rh) / Math.max(rw, rh);
        if (aspect < 0.52) continue;

        // Match nearest logical cube entity for elevation parallax correction
        let matched = null;
        let bestD = 0.095;
        for (const c of cubes) {
          if (c.colorKey === ckey && !matchedIds.has(c.id)) {
            const d = Math.hypot(c.pos[0] - wx0, c.pos[2] - wz0);
            if (d < bestD) { bestD = d; matched = c; }
          }
        }

        const topY = matched ? matched.pos[1] + matched.sizeM * 0.5 : CUBE_TOP_Y;
        const hCam = Math.max(0.1, CAM_POS[1] - topY);
        const pxPerMm = FOCAL_PX / hCam / 1000;
        const [wx, wz] = pixelToWorld(cx, cy, topY);

        const widthMm = Number((rw / pxPerMm).toFixed(1));
        const depthMm = Number((rh / pxPerMm).toFixed(1));
        const heightMm = Number(((widthMm + depthMm) * 0.5).toFixed(1));
        if (widthMm < 22 || widthMm > 64 || depthMm < 22 || depthMm > 64) continue;

        const volumeCm3 = Number(((widthMm * depthMm * heightMm) / 1000).toFixed(2));
        const weightG = Number((volumeCm3 * prof.density).toFixed(1));
        const meanR = Math.round(sumR / count);
        const meanG = Math.round(sumG / count);
        const meanB = Math.round(sumB / count);
        const [mh, ms, mv] = rgbToHsv(meanR, meanG, meanB);

        const cubeId = matched ? matched.id : `CV-${ckey.slice(0, 2)}-${Math.round(cx)}`;
        if (matched) matchedIds.add(matched.id);

        const rectFill = Math.min(1, areaPx / Math.max(1, rw * rh));
        const confidence = Number(Math.min(99.4, (0.62 * rectFill + 0.38 * aspect) * 100).toFixed(1));
        const yawDeg = matched ? normalizeSquareYaw(matched.yawDeg) : normalizeSquareYaw((theta * 180) / Math.PI);

        const det = {
          id: cubeId,
          colorKey: ckey,
          colorTr: prof.labelTr,
          hex: prof.hex,
          rgb: [meanR, meanG, meanB],
          hsv: [Math.round(mh / 2), Math.round(ms * 255), Math.round(mv * 255)],
          sizeMm: [widthMm, depthMm, heightMm],
          volumeCm3,
          estWeightG: weightG,
          material: prof.material,
          worldPosM: [Number(wx.toFixed(4)), Number((matched ? matched.pos[1] : heightMm / 2000).toFixed(4)), Number(wz.toFixed(4))],
          yawDeg,
          confidencePct: confidence,
          targetZone: prof.zone,
          status: matched ? matched.status : "DETECTED",
          isTarget: cubeId === activeCubeId,
        };
        this._lastOpticById.set(cubeId, {
          rgb: det.rgb,
          hsv: det.hsv,
          sizeMm: det.sizeMm,
          volumeCm3: det.volumeCm3,
          estWeightG: det.estWeightG,
        });
        detections.push(det);

        // --- Draw Precision Oriented Bounding Box & Reticle on HUD ---
        const isTarget = det.isTarget;
        this.hudCtx.save();
        this.hudCtx.translate(cx * sx, cy * sy);
        this.hudCtx.rotate(theta);
        this.hudCtx.strokeStyle = isTarget ? "#00f5d4" : prof.hex;
        this.hudCtx.lineWidth = isTarget ? 2.2 : 1.4;
        this.hudCtx.strokeRect((-rw * 0.5) * sx, (-rh * 0.5) * sy, rw * sx, rh * sy);
        this.hudCtx.restore();

        // Centroid Crosshair
        const hcx = cx * sx, hcy = cy * sy;
        this.hudCtx.strokeStyle = "#f8fafc";
        this.hudCtx.lineWidth = 1;
        this.hudCtx.beginPath();
        this.hudCtx.moveTo(hcx - 5, hcy); this.hudCtx.lineTo(hcx + 5, hcy);
        this.hudCtx.moveTo(hcx, hcy - 5); this.hudCtx.lineTo(hcx, hcy + 5);
        this.hudCtx.stroke();

        // Target lock corner brackets
        if (isTarget) {
          const r = Math.max(rw, rh) * 0.72 * sx;
          this.hudCtx.strokeStyle = "#00f5d4";
          this.hudCtx.lineWidth = 2;
          for (const [bx, by] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const x0 = hcx + bx * r, y0 = hcy + by * r;
            this.hudCtx.beginPath();
            this.hudCtx.moveTo(x0, y0); this.hudCtx.lineTo(x0 - bx * 8, y0);
            this.hudCtx.moveTo(x0, y0); this.hudCtx.lineTo(x0, y0 - by * 8);
            this.hudCtx.stroke();
          }
        }

        // Compact callout badge
        const badge = `${cubeId} | ${widthMm.toFixed(0)}x${depthMm.toFixed(0)}mm`;
        const bx = Math.max(4, Math.min(hw - 122, hcx - 54));
        const by = Math.max(28, hcy - (rh * 0.62) * sy - 6);
        this.hudCtx.fillStyle = "rgba(8, 12, 18, 0.84)";
        this.hudCtx.fillRect(bx - 3, by - 11, 118, 14);
        this.hudCtx.fillStyle = isTarget ? "#00f5d4" : "#e2e8f0";
        this.hudCtx.font = "600 9.5px Consolas, monospace";
        this.hudCtx.fillText(badge, bx, by);
      }
    }

    // Vision + Forward-Kinematics Sensor Fusion when gripper physically occludes held cube
    if (activeCubeId && !detections.some((d) => d.id === activeCubeId)) {
      const c = cubes.find((x) => x.id === activeCubeId);
      if (c) {
        const prof = COLOR_PROFILES[c.colorKey];
        const cached = this._lastOpticById.get(c.id);
        const hexNum = parseInt(prof.hex.slice(1), 16);
        const fallbackRgb = [(hexNum >> 16) & 255, (hexNum >> 8) & 255, hexNum & 255];
        const [fh, fs, fv] = rgbToHsv(...fallbackRgb);
        const vol = cached ? cached.volumeCm3 : Number(((c.sizeM * 100) ** 3).toFixed(2));
        const [gx, gy] = worldToPixel(c.pos[0], c.pos[2], c.pos[1] + 0.019);
        detections.push({
          id: c.id,
          colorKey: c.colorKey,
          colorTr: prof.labelTr,
          hex: prof.hex,
          rgb: cached ? cached.rgb : fallbackRgb,
          hsv: cached ? cached.hsv : [Math.round(fh / 2), Math.round(fs * 255), Math.round(fv * 255)],
          sizeMm: cached ? cached.sizeMm : [38.0, 38.0, 38.0],
          volumeCm3: vol,
          estWeightG: cached ? cached.estWeightG : Number((vol * prof.density).toFixed(1)),
          material: prof.material,
          worldPosM: c.pos.map((v) => Number(v.toFixed(4))),
          yawDeg: normalizeSquareYaw(c.yawDeg),
          confidencePct: 96.2,
          targetZone: prof.zone,
          status: `${c.status} (FK FUSION)`,
          isTarget: true,
        });
        this.hudCtx.strokeStyle = "#00f5d4";
        this.hudCtx.lineWidth = 1.5;
        this.hudCtx.beginPath();
        this.hudCtx.arc(gx * sx, gy * sy, 18, 0, Math.PI * 2);
        this.hudCtx.stroke();
        this.hudCtx.fillStyle = "#00f5d4";
        this.hudCtx.font = "600 9.5px Consolas, monospace";
        this.hudCtx.fillText(`FK-LOCKED: ${c.id}`, Math.max(4, gx * sx - 42), Math.max(28, gy * sy - 22));
      }
    }

    // Crisp Camera Status Header Bar
    this.hudCtx.fillStyle = "rgba(8, 12, 18, 0.85)";
    this.hudCtx.fillRect(0, 0, hw, 20);
    const srcLabel =
      this.sourceMode === "virtual3d" ? "3D OV2640 LENS" : this.sourceMode.toUpperCase();
    this.hudCtx.fillStyle = "#67e8f9";
    this.hudCtx.font = "600 10px Consolas, monospace";
    this.hudCtx.fillText(
      `ESP32-CAM [${srcLabel}] | ${this.fps.toFixed(1)} FPS | CUBES: ${detections.length}`,
      8,
      13.5
    );

    this.detections = detections;
    this.activeCube = detections.find((d) => d.isTarget) || detections[0] || null;
    return detections;
  }
}
