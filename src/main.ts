import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

interface Building {
  id: string;
  name?: string;
  h: number;
  b: number;
  fp: number[];
  usage?: string;
  floors?: number;
  basement?: number;
  year?: number;
  structure?: string;
  flood?: number;
  area?: number;
}

interface AreaData {
  name: string;
  origin: { lat: number; lon: number };
  source: string;
  count: number;
  buildings: Building[];
}

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
scene.fog = new THREE.Fog(BG, 250, 1400);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 5000);
camera.position.set(0, 60, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 12;
controls.maxDistance = 900;

scene.add(new THREE.HemisphereLight('#ffffff', '#bfe6f2', 1.6));
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

function applyColorMode(mode: ColorMode) {
  for (const m of buildingMeshes) {
    const b = m.userData.building as Building;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mode === 'aqua') {
      mat.color.set('#ffffff').lerp(new THREE.Color('#bfeaf4'), Math.min(b.h / 150, 1));
      mat.opacity = 0.9;
    } else if (mode === 'height') {
      mat.color.copy(heightColor(b.h));
      mat.opacity = 0.95;
    } else {
      mat.color.copy(floodColor(b.flood));
      mat.opacity = 0.95;
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
    legend.textContent = 'PLATEAUの建物モデル（LOD1）を実寸で配置';
  }
}

function buildCity(data: AreaData) {
  for (const b of data.buildings) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < b.fp.length; i += 2) pts.push(new THREE.Vector2(b.fp[i], -b.fp[i + 1]));
    if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.35,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.building = b;
    buildingGroup.add(mesh);
    buildingMeshes.push(mesh);
    if (b.h > 25) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
      mesh.add(edges);
    }
  }
  applyColorMode('aqua');
  document.getElementById('stats')!.textContent = `${data.count.toLocaleString()} buildings`;
  document.getElementById('area-name')!.textContent = data.name;
}

// ---------- picking / info panel ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected: THREE.Mesh | null = null;
let downPos = { x: 0, y: 0 };

const USAGE: Record<string, string> = {
  '401': '業務施設', '402': '商業施設', '403': '宿泊施設', '404': '商業系複合施設',
  '411': '住宅', '412': '共同住宅', '413': '店舗等併用住宅', '414': '店舗等併用共同住宅',
  '421': '官公庁施設', '422': '文教厚生施設', '431': '運輸倉庫施設', '441': '工場',
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
  raycaster.setFromCamera(pointer, camera);
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

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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
  const speed = keys.has('shift') ? 90 : 35;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    avatar.position.add(move);
    camera.position.add(move);
    avatar.rotation.y = Math.atan2(move.x, move.z);
  }
  body.position.y = 3.6 + Math.sin(t * 2.4) * 0.35;
  ring.rotation.z = t * 0.8;
  ring.position.y = 3.2 + Math.sin(t * 2.4) * 0.35;
  (halo.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 2) * 0.15;
  controls.target.lerp(new THREE.Vector3(avatar.position.x, avatar.position.y + 5, avatar.position.z), 0.2);
  sun.position.set(avatar.position.x + 300, 500, avatar.position.z + 200);
  sun.target.position.copy(avatar.position);
}

// ---------- start ----------
avatar.position.set(-60, 0, 40); // 東京駅丸の内駅前広場付近
camera.position.set(-60, 70, 170);
controls.target.set(-60, 5, 40);

fetch(`${import.meta.env.BASE_URL}data/marunouchi.json`)
  .then((r) => r.json())
  .then((d: AreaData) => buildCity(d))
  .catch((err) => {
    console.error(err);
    document.getElementById('stats')!.textContent = 'データ読み込みに失敗しました';
  });

setTimeout(() => document.getElementById('title')!.classList.add('fade'), 2600);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateAvatar(dt, t);
  updateCubes(t, dt);
  controls.update();
  renderer.render(scene, camera);
});
