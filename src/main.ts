import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

import type { AreaData, Building, Feature, WorldContext } from './types';
import { FEATURES } from './features';

type ColorMode = 'aqua' | 'height' | 'flood';

const BG = new THREE.Color('#e6f5fa');

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

// ---------- floating cubes ----------
const CUBE_COUNT = 420;
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const cubeMat = new THREE.MeshStandardMaterial({
  color: '#9fd4e2',
  transparent: true,
  opacity: 0.55,
  roughness: 0.3,
  metalness: 0.1,
});
const cubes = new THREE.InstancedMesh(cubeGeo, cubeMat, CUBE_COUNT);
const cubeData: { pos: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; size: number; phase: number }[] = [];
const tmpObj = new THREE.Object3D();
for (let i = 0; i < CUBE_COUNT; i++) {
  const r = 60 + Math.random() * 900;
  const a = Math.random() * Math.PI * 2;
  cubeData.push({
    pos: new THREE.Vector3(Math.cos(a) * r, 30 + Math.random() * 260, Math.sin(a) * r),
    rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
    spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4),
    size: 2 + Math.random() * 9,
    phase: Math.random() * Math.PI * 2,
  });
}
scene.add(cubes);

function updateCubes(t: number, dt: number) {
  for (let i = 0; i < CUBE_COUNT; i++) {
    const c = cubeData[i];
    c.rot.x += c.spin.x * dt;
    c.rot.y += c.spin.y * dt;
    tmpObj.position.set(c.pos.x, c.pos.y + Math.sin(t * 0.5 + c.phase) * 4, c.pos.z);
    tmpObj.rotation.copy(c.rot);
    tmpObj.scale.setScalar(c.size);
    tmpObj.updateMatrix();
    cubes.setMatrixAt(i, tmpObj.matrix);
  }
  cubes.instanceMatrix.needsUpdate = true;
}

// ---------- avatar ----------
const avatar = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: '#d9dde0', roughness: 0.45 });
const body = new THREE.Mesh(new THREE.SphereGeometry(3, 40, 28), bodyMat);
body.position.y = 3.6;
body.castShadow = true;
avatar.add(body);
const earMat = new THREE.MeshStandardMaterial({ color: '#4fb8cf', roughness: 0.4 });
for (const s of [-1, 1]) {
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 16), earMat);
  ear.position.set(s * 1.5, 6.9, 0);
  ear.rotation.z = -s * 0.25;
  ear.castShadow = true;
  avatar.add(ear);
}
const ringMat = new THREE.MeshBasicMaterial({ color: '#3cc4e0', transparent: true, opacity: 0.85 });
const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 12, 80), ringMat);
ring.rotation.x = Math.PI / 2;
ring.position.y = 3.2;
avatar.add(ring);
const halo = new THREE.Mesh(
  new THREE.RingGeometry(9, 9.4, 96),
  new THREE.MeshBasicMaterial({ color: '#58c9e0', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.12;
avatar.add(halo);
scene.add(avatar);

// ---------- buildings ----------
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);
const buildingMeshes: THREE.Mesh[] = [];
const edgeMat = new THREE.LineBasicMaterial({ color: '#5fbcd6', transparent: true, opacity: 0.55 });

function heightColor(h: number): THREE.Color {
  const t = Math.min(h / 200, 1);
  return new THREE.Color().setHSL(0.55 - t * 0.55, 0.75, 0.6 - t * 0.1);
}

function floodColor(d?: number): THREE.Color {
  if (d === undefined) return new THREE.Color('#e9f4f7');
  if (d < 0.5) return new THREE.Color('#9fe3f0');
  if (d < 3) return new THREE.Color('#3aa7e0');
  if (d < 5) return new THREE.Color('#2a5fd1');
  return new THREE.Color('#6a2fc0');
}

const AQUA_TINT = new THREE.Color('#cdeef6');

function applyColorMode(mode: ColorMode) {
  for (const m of buildingMeshes) {
    const b = m.userData.building as Building;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mode === 'aqua') {
      mat.color.set('#ffffff').lerp(AQUA_TINT, Math.min(b.h / 260, 1));
    } else if (mode === 'height') {
      mat.color.copy(heightColor(b.h));
    } else {
      mat.color.copy(floodColor(b.flood));
    }
  }
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

function buildCity(data: AreaData) {
  for (const b of data.buildings) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < b.fp.length; i += 2) pts.push(new THREE.Vector2(b.fp[i], -b.fp[i + 1]));
    if (pts.length < 3) continue;
    let geo: THREE.BufferGeometry;
    if (b.g && b.g.i.length > 0) {
      // PLATEAU LOD2 surfaces (roofs / walls), decimeter-quantized
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(b.g.p, (v) => v / 10), 3));
      geo.setIndex(b.g.i);
      geo.computeVertexNormals();
    } else {
      const shape = new THREE.Shape(pts);
      geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
    }
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.35,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.building = b;
    buildingGroup.add(mesh);
    buildingMeshes.push(mesh);
    if (b.h > 25) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
      edges.raycast = () => {};
      mesh.add(edges);
    }
  }
  buildCollisionGrid(data.buildings);
  applyColorMode('aqua');
  document.getElementById('stats')!.textContent = `${data.count.toLocaleString()} buildings`;
}

// ---------- picking / info panel ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected: THREE.Mesh | null = null;
let downPos = { x: 0, y: 0 };
/** camera position used for the last rendered frame (may be pulled in front of buildings) */
const camRendered = new THREE.Vector3();

const USAGE: Record<string, string> = {
  '401': '業務施設', '402': '商業施設', '403': '宿泊施設', '404': '商業系複合施設',
  '411': '住宅', '412': '共同住宅', '413': '店舗等併用住宅', '414': '店舗等併用共同住宅',
  '421': '官公庁施設', '422': '文教厚生施設', '431': '運輸倉庫施設', '441': '工場',
};

const FLOOD_RANK: Record<number, string> = {
  1: '0.5m未満', 2: '0.5〜3m', 3: '3〜5m', 4: '5〜10m', 5: '10〜20m', 6: '20m以上',
};

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
  document.getElementById('info-name')!.textContent = b.name ?? '名称なし建物';
  document.getElementById('info-body')!.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  document.getElementById('info')!.classList.remove('hidden');
}

function select(mesh: THREE.Mesh | null) {
  if (selected) (selected.material as THREE.MeshStandardMaterial).emissive.set('#000000');
  selected = mesh;
  if (mesh) {
    (mesh.material as THREE.MeshStandardMaterial).emissive.set('#1aa6c9');
    showInfo(mesh.userData.building);
  } else {
    document.getElementById('info')!.classList.add('hidden');
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => (downPos = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) return;
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

document.querySelectorAll<HTMLButtonElement>('.mode-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-buttons button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    applyColorMode(btn.dataset.mode as ColorMode);
  });
});

// ---------- movement ----------
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// on-screen joystick for touch devices
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

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const followTarget = new THREE.Vector3();

// ---------- collision against building footprints ----------
const CELL = 40;
let collisionGrid = new Map<string, number[][]>();

function buildCollisionGrid(buildings: Building[]) {
  collisionGrid = new Map();
  for (const b of buildings) {
    if (b.h < 2 || b.fp.length < 6) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < b.fp.length; i += 2) {
      minX = Math.min(minX, b.fp[i]); maxX = Math.max(maxX, b.fp[i]);
      minZ = Math.min(minZ, b.fp[i + 1]); maxZ = Math.max(maxZ, b.fp[i + 1]);
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        let list = collisionGrid.get(key);
        if (!list) collisionGrid.set(key, (list = []));
        list.push(b.fp);
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

function blocked(x: number, z: number): boolean {
  const list = collisionGrid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!list) return false;
  for (const fp of list) if (insidePolygon(x, z, fp)) return true;
  return false;
}

/** nearest walkable point (spiral search) so spawns / teleports never end up inside a building */
function freeSpot(x: number, z: number): [number, number] {
  if (!blocked(x, z)) return [x, z];
  for (let r = 4; r < 400; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!blocked(px, pz)) return [px, pz];
    }
  }
  return [x, z];
}

function updateAvatar(dt: number, t: number) {
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP).normalize();
  move.set(0, 0, 0);
  if (keys.has('w') || keys.has('arrowup')) move.add(forward);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
  if (keys.has('d') || keys.has('arrowright')) move.add(right);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
  if (stick.active) move.addScaledVector(forward, -stick.y).addScaledVector(right, stick.x);
  const speed = keys.has('shift') ? 90 : 35;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    // slide along building walls (PLATEAU footprints) instead of walking through them
    const nx = avatar.position.x + move.x;
    const nz = avatar.position.z + move.z;
    if (blocked(nx, nz)) {
      if (!blocked(nx, avatar.position.z)) move.z = 0;
      else if (!blocked(avatar.position.x, nz)) move.x = 0;
      else move.set(0, 0, 0);
    }
    avatar.position.add(move);
    camera.position.add(move);
    if (move.lengthSq() > 0) avatar.rotation.y = Math.atan2(move.x, move.z);
  }
  body.position.y = 3.6 + Math.sin(t * 2.4) * 0.35;
  ring.rotation.z = t * 0.8;
  ring.position.y = 3.2 + Math.sin(t * 2.4) * 0.35;
  (halo.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 2) * 0.15;
  followTarget.set(avatar.position.x, avatar.position.y + 5, avatar.position.z);
  controls.target.lerp(followTarget, 0.2);
  sun.position.set(avatar.position.x + 300, 500, avatar.position.z + 200);
  sun.target.position.copy(avatar.position);
}

// ---------- start ----------
interface AreaEntry {
  id: string;
  name: string;
  start: [number, number];
  /** camera offset from the avatar when the area opens */
  view: [number, number, number];
}

let currentArea: AreaData | null = null;
let loadingArea = false;

function placeAvatar(entry: AreaEntry) {
  const [fx, fz] = freeSpot(entry.start[0], entry.start[1]);
  avatar.position.set(fx, 0, fz);
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
  getArea: () => currentArea,
  teleport(x: number, z: number) {
    const [fx, fz] = freeSpot(x, z);
    const dx = fx - avatar.position.x;
    const dz = fz - avatar.position.z;
    avatar.position.x = fx;
    avatar.position.z = fz;
    camera.position.x += dx;
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
  if (loadingArea) return;
  loadingArea = true;
  const stats = document.getElementById('stats')!;
  stats.textContent = `${entry.name} を読み込み中…`;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${entry.id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as AreaData;
    d.id ??= entry.id;
    select(null);
    for (const m of buildingMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      for (const c of m.children) (c as THREE.LineSegments).geometry?.dispose();
      buildingGroup.remove(m);
    }
    buildingMeshes.length = 0;
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
    document.querySelectorAll<HTMLButtonElement>('#area-switch button').forEach((b) =>
      b.classList.toggle('active', b.dataset.area === entry.id)
    );
  } catch (err) {
    console.error(err);
    stats.textContent = 'データ読み込みに失敗しました';
  } finally {
    loadingArea = false;
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
  renderer.render(scene, camera);
  camRendered.copy(camera.position);
  camera.position.copy(camDesired);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateAvatar(dt, t);
  updateCubes(t, dt);
  for (const f of features) f.update?.(dt, t);
  controls.update();
  renderWithCameraClamp();
});
