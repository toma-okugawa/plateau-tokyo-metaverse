import * as THREE from 'three';
import type { AreaData, FeatureFactory } from '../../types';
import './minimap.css';

/** Visible width of the minimap, in meters. */
const VIEW_METERS = 700;
const FRAME_SEC = 1 / 20;
const MAP_MARGIN_M = 40;
const MAP_MAX_PX = 4096;
const GRID_STEP_M = 100;

const COL_BG = '#ffffff';
const COL_GRID = 'rgba(143, 211, 230, 0.5)';
const COL_DOT = '#19b6d8';
const COL_CONE = 'rgba(25, 182, 216, 0.55)';
const COL_N = '#0a6fc2';
const COL_HALO = 'rgba(255, 255, 255, 0.95)';
const NORTH_LABEL = 'N';

/** Pale aqua for low buildings, deeper aqua for tall ones. */
function shadeForHeight(h: number, maxH: number): string {
  const t = maxH > 0 ? Math.pow(Math.min(Math.max(h, 0) / maxH, 1), 0.72) : 0;
  const r = Math.round(228 + (10 - 228) * t);
  const g = Math.round(246 + (111 - 246) * t);
  const b = Math.round(251 + (194 - 251) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function traceFootprint(
  g: CanvasRenderingContext2D,
  fp: number[],
  originX: number,
  originZ: number,
  ppm: number,
): boolean {
  if (fp.length < 6) return false;
  if (!Number.isFinite(fp[0]) || !Number.isFinite(fp[1])) return false;
  g.beginPath();
  g.moveTo((fp[0] - originX) * ppm, (fp[1] - originZ) * ppm);
  for (let i = 2; i < fp.length; i += 2) {
    const x = fp[i];
    const z = fp[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    g.lineTo((x - originX) * ppm, (z - originZ) * ppm);
  }
  g.closePath();
  return true;
}

function drawGrid(
  g: CanvasRenderingContext2D,
  originX: number,
  originZ: number,
  ppm: number,
  width: number,
  height: number,
): void {
  const step = GRID_STEP_M;
  g.beginPath();
  const xEnd = originX + width / ppm;
  for (let x = Math.ceil(originX / step) * step; x <= xEnd; x += step) {
    const px = (x - originX) * ppm;
    g.moveTo(px, 0);
    g.lineTo(px, height);
  }
  const zEnd = originZ + height / ppm;
  for (let z = Math.ceil(originZ / step) * step; z <= zEnd; z += step) {
    const py = (z - originZ) * ppm;
    g.moveTo(0, py);
    g.lineTo(width, py);
  }
  g.strokeStyle = COL_GRID;
  g.lineWidth = 1;
  g.stroke();
}

export const createMinimap: FeatureFactory = (ctx) => {
  const wrap = document.createElement('div');
  wrap.className = 'mm-box';
  const canvas = document.createElement('canvas');
  canvas.className = 'mm-canvas';
  canvas.setAttribute('aria-label', 'ミニマップ。クリックでその場所へ移動');
  wrap.append(canvas);
  document.body.append(wrap);

  const g0 = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const og0 = off.getContext('2d');
  if (!g0 || !og0) return {};
  const g = g0;
  const og = og0;

  const heading = new THREE.Vector3();
  let mapReady = false;
  let mapOriginX = 0;
  let mapOriginZ = 0;
  let mapPpm = 1;
  let viewH = VIEW_METERS;
  let accum = 0;
  let overlayDpr = -1;
  let dotRadius = 4;
  let dotLine = 2;
  let coneLen = 22;
  let coneHalf = 8;
  let coneBack = 3;
  let nPad = 6;
  let nHalo = 3;
  let nFont = '800 12px sans-serif';

  function ensureCanvasSize(): boolean {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 2 || cssH < 2) return false;
    const dpr = Math.min(ctx.renderer.getPixelRatio() || 1, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w === canvas.width && h === canvas.height && dpr === overlayDpr) return true;
    canvas.width = w;
    canvas.height = h;
    overlayDpr = dpr;
    viewH = VIEW_METERS * (h / w);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    dotRadius = 4.2 * dpr;
    dotLine = Math.max(1, 1.6 * dpr);
    coneLen = 22 * dpr;
    coneHalf = 8 * dpr;
    coneBack = 2.5 * dpr;
    nPad = 5 * dpr;
    nHalo = Math.max(2, 3 * dpr);
    nFont = '800 ' + Math.round(12 * dpr) + 'px "Segoe UI", "Yu Gothic UI", sans-serif';
    return true;
  }

  function paintMap(area: AreaData): void {
    mapReady = false;
    const buildings = area.buildings;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxH = 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.h > maxH) maxH = b.h;
      const fp = b.fp;
      for (let p = 0; p < fp.length; p += 2) {
        const x = fp[p];
        const z = fp[p + 1];
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      return;
    }

    const worldW = Math.max(maxX - minX, 1) + MAP_MARGIN_M * 2;
    const worldH = Math.max(maxZ - minZ, 1) + MAP_MARGIN_M * 2;
    const longest = Math.max(worldW, worldH);
    const ppm = longest > MAP_MAX_PX ? MAP_MAX_PX / longest : 1;
    const pixW = Math.max(1, Math.ceil(worldW * ppm));
    const pixH = Math.max(1, Math.ceil(worldH * ppm));
    off.width = pixW;
    off.height = pixH;
    mapOriginX = minX - MAP_MARGIN_M;
    mapOriginZ = minZ - MAP_MARGIN_M;
    mapPpm = ppm;

    og.fillStyle = COL_BG;
    og.fillRect(0, 0, pixW, pixH);
    drawGrid(og, mapOriginX, mapOriginZ, ppm, pixW, pixH);

    const order = buildings.slice();
    order.sort((a, b) => a.h - b.h);
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      if (!traceFootprint(og, b.fp, mapOriginX, mapOriginZ, ppm)) continue;
      og.fillStyle = shadeForHeight(b.h, maxH);
      og.fill();
    }
    mapReady = true;
  }

  function draw(): void {
    if (!ensureCanvasSize()) return;
    const dw = canvas.width;
    const dh = canvas.height;
    g.clearRect(0, 0, dw, dh);
    g.fillStyle = COL_BG;
    g.fillRect(0, 0, dw, dh);

    if (mapReady && mapPpm > 0 && off.width > 0 && off.height > 0) {
      const scale = dw / VIEW_METERS / mapPpm;
      const ax = (ctx.avatar.position.x - mapOriginX) * mapPpm;
      const az = (ctx.avatar.position.z - mapOriginZ) * mapPpm;
      g.drawImage(off, dw * 0.5 - ax * scale, dh * 0.5 - az * scale, off.width * scale, off.height * scale);
    }

    const cx = dw * 0.5;
    const cy = dh * 0.5;
    // World +x is east and +z is south. Canvas +y points down, so south is down and north is up.
    ctx.camera.getWorldDirection(heading);
    const hx = heading.x;
    const hz = heading.z;
    const hlen = Math.hypot(hx, hz);
    if (hlen > 0.02) {
      const nx = hx / hlen;
      const ny = hz / hlen;
      const px = -ny;
      const py = nx;
      g.beginPath();
      g.moveTo(cx + nx * coneLen, cy + ny * coneLen);
      g.lineTo(cx - nx * coneBack + px * coneHalf, cy - ny * coneBack + py * coneHalf);
      g.lineTo(cx - nx * coneBack - px * coneHalf, cy - ny * coneBack - py * coneHalf);
      g.closePath();
      g.fillStyle = COL_CONE;
      g.fill();
    }

    g.beginPath();
    g.arc(cx, cy, dotRadius, 0, Math.PI * 2);
    g.fillStyle = COL_DOT;
    g.fill();
    g.lineWidth = dotLine;
    g.strokeStyle = COL_BG;
    g.stroke();

    g.font = nFont;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = nHalo;
    g.lineJoin = 'round';
    g.strokeStyle = COL_HALO;
    g.strokeText(NORTH_LABEL, cx, nPad);
    g.fillStyle = COL_N;
    g.fillText(NORTH_LABEL, cx, nPad);
  }

  function update(dt: number): void {
    accum += dt;
    if (accum < FRAME_SEC) return;
    accum -= FRAME_SEC;
    if (accum > FRAME_SEC) accum = FRAME_SEC;
    draw();
  }

  function onAreaLoaded(area: AreaData): void {
    paintMap(area);
    accum = 0;
    draw();
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const u = (ev.clientX - rect.left) / rect.width;
    const v = (ev.clientY - rect.top) / rect.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    ensureCanvasSize();
    const x = ctx.avatar.position.x + (u - 0.5) * VIEW_METERS;
    const z = ctx.avatar.position.z + (v - 0.5) * viewH;
    ctx.teleport(x, z);
  });

  const observer = new ResizeObserver(() => {
    draw();
  });
  observer.observe(canvas);
  draw();

  return { update, onAreaLoaded };
};
