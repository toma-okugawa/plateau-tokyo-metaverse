import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import './style.css';

import type { AreaData, Building, Feature, WorldContext } from './types';
import { FEATURES } from './features';
import { createAvatar } from './world/avatar';

type ColorMode = 'aqua' | 'height' | 'flood';

const BG = new THREE.Color('#e6f5fa');

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// thousands of buildings: only re-render the shadow map when the sun actually moves (see updateShadows)
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 500, 2200);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 5000);
camera.position.set(0, 60, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 12;
controls.maxDistance = 900;

const hemi = new THREE.HemisphereLight('#ffffff', '#bfe6f2', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(300, 500, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// buildings are DoubleSide, so lit faces are in the shadow map too: bias against acne
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.4;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.far = 1500;
scene.add(sun);
scene.add(sun.target);

// ---------- ground & grid ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000),
  new THREE.MeshStandardMaterial({ color: '#f4fbfd', roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(6000, 600, '#8fd3e6', '#c5e9f3');
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.75;
grid.position.y = 0.05;
scene.add(grid);

// ---------- avatar ----------
const { root: avatar, animate: animateAvatar } = createAvatar();
scene.add(avatar);

// ---------- buildings ----------
// Every building keeps its own proxy Mesh (not rendered) for picking, camera collision and the
// feature modules. What is drawn is the city merged into ~250 m chunks with per-vertex colors,
// so an area costs ~40 draw calls instead of one per building.
const CHUNK_SIZE = 250;
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);
const buildingMeshes: THREE.Mesh[] = [];
const chunkMeshes: THREE.Mesh[] = [];
const proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const chunkMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.35,
  metalness: 0.05,
  side: THREE.DoubleSide,
});
const edgeMat = new THREE.LineBasicMaterial({ color: '#5fbcd6', transparent: true, opacity: 0.55 });

/** where a building's vertices live inside its render chunk */
interface ChunkRange {
  color: THREE.BufferAttribute;
  start: number;
  count: number;
}
const chunkRanges = new Map<THREE.Mesh, ChunkRange>();
/** bumped whenever the city geometry is rebuilt (forces a shadow map refresh) */
let cityVersion = 0;

function heightColor(h: number, out: THREE.Color): THREE.Color {
  const t = Math.min(h / 200, 1);
  return out.setHSL(0.55 - t * 0.55, 0.75, 0.6 - t * 0.1);
}

const FLOOD_COLORS = ['#e9f4f7', '#9fe3f0', '#3aa7e0', '#2a5fd1', '#6a2fc0'].map((c) => new THREE.Color(c));
function floodColor(d: number | undefined, out: THREE.Color): THREE.Color {
  if (d === undefined) return out.copy(FLOOD_COLORS[0]);
  if (d < 0.5) return out.copy(FLOOD_COLORS[1]);
  if (d < 3) return out.copy(FLOOD_COLORS[2]);
  if (d < 5) return out.copy(FLOOD_COLORS[3]);
  return out.copy(FLOOD_COLORS[4]);
}

const AQUA_TINT = new THREE.Color('#cdeef6');
const WHITE = new THREE.Color('#ffffff');
let colorMode: ColorMode = 'aqua';

function applyColorMode(mode: ColorMode) {
  colorMode = mode;
  const c = new THREE.Color();
  const dirty = new Set<THREE.BufferAttribute>();
  for (const m of buildingMeshes) {
    const b = m.userData.building as Building;
    const range = chunkRanges.get(m);
    if (!range) continue;
    if (mode === 'aqua') c.copy(WHITE).lerp(AQUA_TINT, Math.min(b.h / 260, 1));
    else if (mode === 'height') heightColor(b.h, c);
    else floodColor(b.flood, c);
    const arr = range.color.array as Float32Array;
    for (let i = range.start * 3, end = (range.start + range.count) * 3; i < end; i += 3) {
      arr[i] = c.r;
      arr[i + 1] = c.g;
      arr[i + 2] = c.b;
    }
    dirty.add(range.color);
  }
  for (const attr of dirty) attr.needsUpdate = true;

  document.querySelectorAll<HTMLButtonElement>('.mode-buttons button').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
  const legend = document.getElementById('legend')!;
  if (mode === 'height') {
    legend.innerHTML =
      '<div class="bar" style="background:linear-gradient(90deg,hsl(198,75%,60%),hsl(99,75%,55%),hsl(0,75%,50%))"></div><div class="row"><span>0m</span><span>100m</span><span>200m+</span></div>';
  } else if (mode === 'flood') {
    legend.innerHTML =
      '<div>想定最大浸水深（洪水）</div><div class="bar" style="background:linear-gradient(90deg,#e9f4f7,#9fe3f0,#3aa7e0,#2a5fd1,#6a2fc0)"></div><div class="row"><span>なし</span><span>0.5m</span><span>3m</span><span>5m+</span></div>';
  } else {
    legend.textContent = 'PLATEAUの建物モデル（LOD2 / LOD1）を実寸で配置';
  }
}

function buildingGeometry(b: Building): THREE.BufferGeometry | null {
  if (b.g && b.g.i.length > 0) {
    // PLATEAU LOD2 surfaces (roofs / walls), decimeter-quantized
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(b.g.p, (v) => v / 10), 3));
    geo.setIndex(b.g.i);
    geo.computeVertexNormals();
    return geo;
  }
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < b.fp.length; i += 2) pts.push(new THREE.Vector2(b.fp[i], -b.fp[i + 1]));
  if (pts.length < 3) return null;
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: b.h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  return geo;
}

/**
 * Merge the buildings of one chunk into a single indexed geometry. The per-building proxies are then
 * re-pointed at views (subarrays) of the merged position / normal buffers, so the CPU copy is shared.
 */
function mergeChunk(list: THREE.Mesh[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const p of list) {
    const n = p.geometry.getAttribute('position').count;
    vCount += n;
    iCount += p.geometry.index ? p.geometry.index.count : n;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  const color = new THREE.BufferAttribute(new Float32Array(vCount * 3), 3);
  let vOff = 0;
  let iOff = 0;
  for (const p of list) {
    const g = p.geometry;
    const gp = g.getAttribute('position').array as Float32Array;
    const gn = g.getAttribute('normal').array as Float32Array;
    const n = gp.length / 3;
    pos.set(gp, vOff * 3);
    nor.set(gn, vOff * 3);
    let local: Uint32Array | null = null;
    if (g.index) {
      const gi = g.index.array;
      local = new Uint32Array(gi.length);
      for (let k = 0; k < gi.length; k++) {
        local[k] = gi[k];
        idx[iOff + k] = gi[k] + vOff;
      }
      iOff += gi.length;
    } else {
      for (let k = 0; k < n; k++) idx[iOff + k] = vOff + k;
      iOff += n;
    }
    // the proxy keeps its own small index but shares the vertex data with the chunk
    const shared = new THREE.BufferGeometry();
    shared.setAttribute('position', new THREE.BufferAttribute(pos.subarray(vOff * 3, (vOff + n) * 3), 3));
    shared.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(vOff * 3, (vOff + n) * 3), 3));
    if (local) shared.setIndex(new THREE.BufferAttribute(local, 1));
    shared.boundingBox = g.boundingBox;
    shared.boundingSphere = g.boundingSphere;
    g.dispose();
    p.geometry = shared;
    chunkRanges.set(p, { color, start: vOff, count: n });
    vOff += n;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('color', color);
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  merged.computeBoundingSphere();
  return merged;
}

function clearCity() {
  for (const m of buildingMeshes) m.geometry.dispose();
  buildingMeshes.length = 0;
  chunkRanges.clear();
  for (const c of chunkMeshes) {
    c.geometry.dispose();
    for (const child of c.children) (child as THREE.LineSegments).geometry.dispose();
    buildingGroup.remove(c);
  }
  chunkMeshes.length = 0;
}

function buildCity(data: AreaData) {
  const chunks = new Map<string, THREE.Mesh[]>();
  for (const b of data.buildings) {
    const geo = buildingGeometry(b);
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const proxy = new THREE.Mesh(geo, proxyMat);
    proxy.userData.building = b;
    buildingMeshes.push(proxy);
    let cx = 0, cz = 0;
    for (let i = 0; i < b.fp.length; i += 2) { cx += b.fp[i]; cz += b.fp[i + 1]; }
    const n = b.fp.length / 2;
    const key = `${Math.floor(cx / n / CHUNK_SIZE)},${Math.floor(cz / n / CHUNK_SIZE)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(proxy);
  }

  for (const list of chunks.values()) {
    const chunk = new THREE.Mesh(mergeChunk(list), chunkMat);
    chunk.castShadow = true;
    chunk.receiveShadow = true;
    chunk.raycast = () => {}; // picking goes through the per-building proxies
    // outline the taller buildings, merged into one line object per chunk
    const edges: THREE.BufferGeometry[] = [];
    for (const p of list) {
      if ((p.userData.building as Building).h > 25) edges.push(new THREE.EdgesGeometry(p.geometry, 30));
    }
    if (edges.length) {
      const edgeGeo = mergeGeometries(edges, false);
      for (const e of edges) e.dispose();
      if (edgeGeo) {
        const lines = new THREE.LineSegments(edgeGeo, edgeMat);
        lines.raycast = () => {};
        chunk.add(lines);
      }
    }
    buildingGroup.add(chunk);
    chunkMeshes.push(chunk);
  }
  cityVersion++;
  buildCollisionGrid(data.buildings);
  applyColorMode(colorMode);
  document.getElementById('stats')!.textContent = `${data.count.toLocaleString()} buildings`;
}

// ---------- picking / info panel ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
/** camera position used for the last rendered frame (may be pulled in front of buildings) */
const camRendered = new THREE.Vector3();
const EMPTY_GEOMETRY = new THREE.BufferGeometry();
const highlight = new THREE.Mesh(
  EMPTY_GEOMETRY,
  new THREE.MeshStandardMaterial({
    color: '#bdf3ff',
    emissive: '#1aa6c9',
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
);
highlight.visible = false;
highlight.raycast = () => {};
scene.add(highlight);

const USAGE: Record<string, string> = {
  '401': '業務施設', '402': '商業施設', '403': '宿泊施設', '404': '商業系複合施設',
  '411': '住宅', '412': '共同住宅', '413': '店舗等併用住宅', '414': '店舗等併用共同住宅',
  '421': '官公庁施設', '422': '文教厚生施設', '431': '運輸倉庫施設', '441': '工場',
};

const FLOOD_RANK: Record<number, string> = {
  1: '0.5m未満', 2: '0.5〜3m', 3: '3〜5m', 4: '5〜10m', 5: '10〜20m', 6: '20m以上',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function showInfo(b: Building) {
  const rows: [string, string][] = [
    ['計測高さ', `${b.h.toFixed(1)} m`],
    ['地盤標高', `${b.b.toFixed(1)} m`],
  ];
  if (b.floors !== undefined) rows.push(['地上階数', `${b.floors} 階`]);
  if (b.basement !== undefined) rows.push(['地下階数', `${b.basement} 階`]);
  if (b.usage) rows.push(['用途', USAGE[b.usage] ?? b.usage]);
  if (b.year) rows.push(['建築年', `${b.year} 年`]);
  if (b.area) rows.push(['延床面積', `${Math.round(b.area).toLocaleString()} ㎡`]);
  rows.push(['想定浸水深', b.flood !== undefined ? `${b.flood.toFixed(2)} m` : '区域外']);
  if (b.floodRank !== undefined) rows.push(['浸水ランク', FLOOD_RANK[b.floodRank] ?? String(b.floodRank)]);
  if (b.floodRiver) rows.push(['対象河川', b.floodRiver]);
  rows.push(['モデル', b.g ? 'LOD2（屋根形状あり）' : 'LOD1（箱型）']);
  document.getElementById('info-name')!.textContent = b.name ?? '名称なし建物';
  document.getElementById('info-body')!.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');
  document.getElementById('info')!.classList.remove('hidden');
}

function select(mesh: THREE.Mesh | null) {
  if (mesh) {
    highlight.geometry = mesh.geometry;
    highlight.visible = true;
    showInfo(mesh.userData.building);
  } else {
    highlight.visible = false;
    highlight.geometry = EMPTY_GEOMETRY;
    document.getElementById('info')!.classList.add('hidden');
  }
}

// a tap selects; drags and pinch-zooms (more than one pointer down) do not
let downPos = { x: 0, y: 0 };
const activePointers = new Set<number>();
let multiTouch = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) multiTouch = true;
  downPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointercancel', (e) => activePointers.delete(e.pointerId));
renderer.domElement.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  const wasMulti = multiTouch;
  if (activePointers.size === 0) multiTouch = false;
  if (wasMulti || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  // pick from where the frame was actually rendered (see renderWithCameraClamp)
  const saved = camera.position.clone();
  camera.position.copy(camRendered);
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  camera.position.copy(saved);
  camera.updateMatrixWorld();
  const hit = raycaster.intersectObjects(buildingMeshes, false)[0];
  select(hit ? (hit.object as THREE.Mesh) : null);
});
document.getElementById('info-close')!.addEventListener('click', () => select(null));

// landmarks feature asks to focus a building -> select it and show its PLATEAU attributes
window.addEventListener('plateau:focus', (e) => {
  const b = (e as CustomEvent<Building>).detail;
  const mesh = buildingMeshes.find((m) => m.userData.building === b);
  if (mesh) select(mesh);
});

document.querySelectorAll<HTMLButtonElement>('.mode-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => applyColorMode(btn.dataset.mode as ColorMode));
});

// ---------- input ----------
// KeyboardEvent.code keeps WASD working while a Japanese IME is on
const keys = new Set<string>();
const isFormField = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');
window.addEventListener('keydown', (e) => {
  if (isFormField(e.target)) return; // arrow keys on a slider change the slider, not the avatar
  if (e.code === 'Space') e.preventDefault(); // Space floats; never "clicks" a focused button
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) keys.clear();
});
const down = (...codes: string[]) => codes.some((c) => keys.has(c));

// on-screen joystick + float button for touch devices
const stick = { active: false, x: 0, y: 0, id: -1 };
const stickEl = document.getElementById('joystick')!;
const knobEl = stickEl.querySelector<HTMLElement>('.knob')!;
function stickMove(e: PointerEvent) {
  const r = stickEl.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  stick.x = dx;
  stick.y = dy;
  knobEl.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
}
stickEl.addEventListener('pointerdown', (e) => {
  stick.active = true;
  stick.id = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  stickMove(e);
});
stickEl.addEventListener('pointermove', (e) => {
  if (stick.active && e.pointerId === stick.id) stickMove(e);
});
const stickEnd = (e: PointerEvent) => {
  if (e.pointerId !== stick.id) return;
  stick.active = false;
  stick.x = stick.y = 0;
  knobEl.style.transform = '';
};
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);

let floatHeld = false;
const floatBtn = document.getElementById('float-btn')!;
floatBtn.addEventListener('pointerdown', (e) => {
  floatHeld = true;
  floatBtn.setPointerCapture(e.pointerId);
});
const floatEnd = () => (floatHeld = false);
floatBtn.addEventListener('pointerup', floatEnd);
floatBtn.addEventListener('pointercancel', floatEnd);

// ---------- collision against building footprints ----------
const CELL = 40;
const AVATAR_RADIUS = 2.5;
/** how high the avatar can step up without floating */
const STEP = 1.5;
interface FootprintRef {
  fp: number[];
  h: number;
}
let collisionGrid = new Map<string, FootprintRef[]>();

function buildCollisionGrid(buildings: Building[]) {
  collisionGrid = new Map();
  for (const b of buildings) {
    if (b.h < 2 || b.fp.length < 6) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < b.fp.length; i += 2) {
      minX = Math.min(minX, b.fp[i]); maxX = Math.max(maxX, b.fp[i]);
      minZ = Math.min(minZ, b.fp[i + 1]); maxZ = Math.max(maxZ, b.fp[i + 1]);
    }
    const ref = { fp: b.fp, h: b.h };
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        let list = collisionGrid.get(key);
        if (!list) collisionGrid.set(key, (list = []));
        list.push(ref);
      }
    }
  }
}

function insidePolygon(x: number, z: number, fp: number[]): boolean {
  let inside = false;
  for (let i = 0, j = fp.length - 2; i < fp.length; j = i, i += 2) {
    const xi = fp[i], zi = fp[i + 1], xj = fp[j], zj = fp[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** roof height under a point (0 = street) */
function roofAt(x: number, z: number): number {
  const list = collisionGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  let h = 0;
  if (list) for (const f of list) if (f.h > h && insidePolygon(x, z, f.fp)) h = f.h;
  return h;
}

/** highest roof under the avatar's body (center + 4 points on its radius) */
function bodyRoofAt(x: number, z: number): number {
  const r = AVATAR_RADIUS;
  return Math.max(roofAt(x, z), roofAt(x + r, z), roofAt(x - r, z), roofAt(x, z + r), roofAt(x, z - r));
}

/** nearest walkable street point (spiral search) so spawns / teleports never end up inside a building */
function freeSpot(x: number, z: number): [number, number] {
  if (bodyRoofAt(x, z) === 0) return [x, z];
  for (let r = 4; r < 400; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (bodyRoofAt(px, pz) === 0) return [px, pz];
    }
  }
  return [x, z];
}

// ---------- movement & floating ----------
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const followTarget = new THREE.Vector3();
const before = new THREE.Vector3();
/** vertical speed (m/s) */
let vy = 0;
const MAX_FLOAT = 600;

function updateAvatar(dt: number, t: number) {
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP).normalize();
  move.set(0, 0, 0);
  if (down('KeyW', 'ArrowUp')) move.add(forward);
  if (down('KeyS', 'ArrowDown')) move.sub(forward);
  if (down('KeyD', 'ArrowRight')) move.add(right);
  if (down('KeyA', 'ArrowLeft')) move.sub(right);
  if (stick.active) move.addScaledVector(forward, -stick.y).addScaledVector(right, stick.x);
  const y = avatar.position.y;
  const speed = (down('ShiftLeft', 'ShiftRight') ? 90 : 35) * (y > 20 ? 1.6 : 1);
  before.copy(avatar.position);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    // slide along building walls; anything lower than our feet (+ a step) can be walked / floated over
    const nx = avatar.position.x + move.x;
    const nz = avatar.position.z + move.z;
    const limit = y + STEP;
    if (bodyRoofAt(nx, nz) > limit) {
      if (bodyRoofAt(nx, avatar.position.z) <= limit) move.z = 0;
      else if (bodyRoofAt(avatar.position.x, nz) <= limit) move.x = 0;
      else move.set(0, 0, 0);
    }
    avatar.position.add(move);
    if (move.lengthSq() > 0) avatar.rotation.y = Math.atan2(move.x, move.z);
  }

  // fluffy floating: hold Space (or the float button) to rise, release to drift down slowly
  if (down('Space') || floatHeld) vy = Math.min(vy + 34 * dt, 26);
  else vy = Math.max(vy - 7 * dt, -14);
  avatar.position.y += vy * dt;
  // a roof is only a floor if we are above it (walking into a wall never teleports us up)
  let floor = bodyRoofAt(avatar.position.x, avatar.position.z);
  if (floor > y + STEP + 0.01) floor = 0;
  if (avatar.position.y <= floor) {
    avatar.position.y = floor;
    vy = 0;
  }
  if (avatar.position.y > MAX_FLOAT) {
    avatar.position.y = MAX_FLOAT;
    vy = Math.min(vy, 0);
  }
  // the camera travels with the avatar (orbit offset stays the same)
  camera.position.add(followTarget.subVectors(avatar.position, before));

  animateAvatar(t, dt, avatar.position.y - floor);
  followTarget.set(avatar.position.x, avatar.position.y + 5, avatar.position.z);
  controls.target.lerp(followTarget, 0.2);
  sun.position.set(avatar.position.x + 300, 500, avatar.position.z + 200);
  sun.target.position.set(avatar.position.x, 0, avatar.position.z);
}

// ---------- areas ----------
interface AreaEntry {
  id: string;
  name: string;
  start: [number, number];
  /** camera offset from the avatar when the area opens */
  view: [number, number, number];
}

let currentArea: AreaData | null = null;
let loadingArea = false;
let pendingArea: AreaEntry | null = null;

function placeAvatar(entry: AreaEntry) {
  const [fx, fz] = freeSpot(entry.start[0], entry.start[1]);
  avatar.position.set(fx, 0, fz);
  vy = 0;
  camera.position.set(fx + entry.view[0], entry.view[1], fz + entry.view[2]);
  controls.target.set(fx, 5, fz);
}

const ctx: WorldContext = {
  scene,
  camera,
  renderer,
  avatar,
  sun,
  hemi,
  getBuildings: () => buildingMeshes,
  getRenderChunks: () => chunkMeshes,
  getArea: () => currentArea,
  teleport(x: number, z: number) {
    const [fx, fz] = freeSpot(x, z);
    const dx = fx - avatar.position.x;
    const dy = -avatar.position.y;
    const dz = fz - avatar.position.z;
    avatar.position.set(fx, 0, fz);
    vy = 0;
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    controls.target.set(fx, 5, fz);
  },
  leftStack: document.getElementById('left-stack')!,
};

const features: Feature[] = [];
for (const factory of FEATURES) {
  try {
    features.push(factory(ctx));
  } catch (err) {
    console.error('feature init failed', err);
  }
}

async function loadArea(entry: AreaEntry) {
  if (loadingArea) {
    pendingArea = entry; // load the most recently requested area once this one is done
    return;
  }
  loadingArea = true;
  const stats = document.getElementById('stats')!;
  stats.textContent = `${entry.name} を読み込み中…`;
  document.querySelectorAll<HTMLButtonElement>('#area-switch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.area === entry.id)
  );
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${entry.id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as AreaData;
    d.id ??= entry.id;
    select(null);
    clearCity();
    currentArea = d;
    buildCity(d);
    placeAvatar(entry);
    history.replaceState(null, '', `#${entry.id}`);
    for (const f of features) {
      try {
        f.onAreaLoaded?.(d, buildingMeshes);
      } catch (err) {
        console.error('feature onAreaLoaded failed', err);
      }
    }
  } catch (err) {
    console.error(err);
    stats.textContent = 'データ読み込みに失敗しました';
  } finally {
    loadingArea = false;
  }
  if (pendingArea) {
    const next = pendingArea;
    pendingArea = null;
    if (next.id !== currentArea?.id) await loadArea(next);
  }
}

async function init() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/areas.json`);
  const areas = (await res.json()) as AreaEntry[];
  const sw = document.getElementById('area-switch')!;
  for (const a of areas) {
    const btn = document.createElement('button');
    btn.textContent = a.name;
    btn.dataset.area = a.id;
    btn.addEventListener('click', () => loadArea(a));
    sw.appendChild(btn);
  }
  const fromHash = () => areas.find((a) => `#${a.id}` === location.hash);
  window.addEventListener('hashchange', () => {
    const a = fromHash();
    if (a && a.id !== currentArea?.id) loadArea(a);
  });
  await loadArea(fromHash() ?? areas[0]);
}

init().catch((err) => {
  console.error(err);
  document.getElementById('stats')!.textContent = 'データ読み込みに失敗しました';
});

setTimeout(() => document.getElementById('title')!.classList.add('fade'), 2600);

// operation panels can be hidden so they never block the view (button or H key; remembered per browser)
const panelToggle = document.getElementById('panel-toggle')!;
function setPanels(open: boolean) {
  document.body.classList.toggle('panels-hidden', !open);
  panelToggle.setAttribute('aria-pressed', String(open));
  try {
    localStorage.setItem('tokyo-twin:panels', open ? '1' : '0');
  } catch {
    /* storage unavailable: just don't remember */
  }
}
let savedPanels: string | null = null;
try {
  savedPanels = localStorage.getItem('tokyo-twin:panels');
} catch {
  /* ignore */
}
// phones start with the panels closed so the city is visible
setPanels(savedPanels ? savedPanels === '1' : !window.matchMedia('(max-width: 640px)').matches);
panelToggle.addEventListener('click', () => setPanels(document.body.classList.contains('panels-hidden')));
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && !e.repeat && !isFormField(e.target)) setPanels(document.body.classList.contains('panels-hidden'));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Third-person "spring arm": if a building stands between the avatar and the camera,
// render from just in front of it (the orbit distance chosen by the user is kept).
const camRay = new THREE.Raycaster();
const camDesired = new THREE.Vector3();
const camDir = new THREE.Vector3();

function renderWithCameraClamp() {
  camDesired.copy(camera.position);
  camDir.subVectors(camera.position, controls.target);
  const dist = camDir.length();
  if (dist > 0.001) {
    camDir.divideScalar(dist);
    camRay.set(controls.target, camDir);
    camRay.far = dist;
    const hit = camRay.intersectObjects(buildingMeshes, false)[0];
    if (hit) camera.position.copy(controls.target).addScaledVector(camDir, Math.max(hit.distance - 2, 2));
  }
  if (camera.position.y < 1) camera.position.y = 1;
  renderer.render(scene, camera);
  camRendered.copy(camera.position);
  camera.position.copy(camDesired);
}

// Snap the sun to a coarse grid around the avatar so the (expensive) shadow map is
// refreshed only after walking ~30 m, when the time of day changes or an area loads.
const SHADOW_SNAP = 30;
const lastSun = new THREE.Vector3(Infinity, 0, 0);
let lastCityVersion = -1;
function updateShadows() {
  const ox = Math.round(avatar.position.x / SHADOW_SNAP) * SHADOW_SNAP - avatar.position.x;
  const oz = Math.round(avatar.position.z / SHADOW_SNAP) * SHADOW_SNAP - avatar.position.z;
  sun.position.x += ox;
  sun.position.z += oz;
  sun.target.position.x += ox;
  sun.target.position.z += oz;
  // keep the shadow frustum on the city even while floating high
  sun.position.y -= sun.target.position.y;
  sun.target.position.y = 0;
  if (lastSun.distanceToSquared(sun.position) > 0.01 || lastCityVersion !== cityVersion) {
    lastSun.copy(sun.position);
    lastCityVersion = cityVersion;
    renderer.shadowMap.needsUpdate = true;
  }
}

if (import.meta.env.DEV) Object.assign(window, { __world: { ctx, controls } }); // debugging aid

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateAvatar(dt, t);
  for (const f of features) f.update?.(dt, t);
  updateShadows();
  controls.update();
  renderWithCameraClamp();
});
