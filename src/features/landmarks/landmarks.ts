import * as THREE from 'three';
import type { AreaData, Building, FeatureFactory } from '../../types';
import './landmarks.css';

const MAX_ROWS = 40;
const MAX_LABELS = 15;
const SOUTH_M = 40;
const LABEL_Y_LIFT = 12;
/** 20 m tall reads as about 25 px of glyphs at 500 m (55° FOV, ~900 px viewport). */
const LABEL_WORLD_H = 20;
const FONT_PX = 72;
const LABEL_FONT =
  '700 ' + FONT_PX + 'px "Yu Gothic UI", "Yu Gothic", "Hiragino Sans", "Meiryo", "MS PGothic", sans-serif';
const PILL_BG = 'rgba(11, 59, 92, 0.85)';

interface NamedMark {
  building: Building;
  cx: number;
  cz: number;
}

function footprintCentroid(fp: number[]): { x: number; z: number } {
  const n = fp.length >> 1;
  if (n <= 0) return { x: 0, z: 0 };
  let twiceArea = 0;
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x0 = fp[i * 2];
    const z0 = fp[i * 2 + 1];
    const x1 = fp[j * 2];
    const z1 = fp[j * 2 + 1];
    if (!Number.isFinite(x0) || !Number.isFinite(z0) || !Number.isFinite(x1) || !Number.isFinite(z1)) continue;
    const cross = x0 * z1 - x1 * z0;
    twiceArea += cross;
    sx += (x0 + x1) * cross;
    sz += (z0 + z1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-4) {
    let ax = 0;
    let az = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const x = fp[i * 2];
      const z = fp[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      ax += x;
      az += z;
      count++;
    }
    if (count === 0) return { x: 0, z: 0 };
    return { x: ax / count, z: az / count };
  }
  return { x: sx / (3 * twiceArea), z: sz / (3 * twiceArea) };
}

function formatMeters(h: number): string {
  if (!Number.isFinite(h)) return '- m';
  return h.toFixed(1) + ' m';
}

function makePill(measure: CanvasRenderingContext2D, text: string): { texture: THREE.CanvasTexture; aspect: number } | null {
  measure.font = LABEL_FONT;
  const metrics = measure.measureText(text);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || FONT_PX * 0.8);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || FONT_PX * 0.2);
  const textW = Math.ceil(metrics.width);
  const padX = Math.round(FONT_PX * 0.62);
  const padY = Math.round(FONT_PX * 0.26);
  const w = Math.max(2, textW + padX * 2);
  const h = Math.max(2, ascent + descent + padY * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.beginPath();
  g.roundRect(1, 1, w - 2, h - 2, (h - 2) / 2);
  g.fillStyle = PILL_BG;
  g.fill();
  g.font = LABEL_FONT;
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(text, padX, padY + ascent);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, aspect: w / h };
}

export const createLandmarks: FeatureFactory = (ctx) => {
  const card = document.createElement('div');
  card.className = 'card lm-card';

  const title = document.createElement('h2');
  title.className = 'lm-title';
  title.textContent = 'ランドマーク';

  const search = document.createElement('input');
  search.className = 'lm-search';
  search.type = 'search';
  search.placeholder = '建物名で検索';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('aria-label', '建物名で検索');

  const list = document.createElement('div');
  list.className = 'lm-list';
  list.setAttribute('role', 'list');

  card.append(title, search, list);
  // Keep WASD / arrow keys from moving the avatar while the panel is focused.
  card.addEventListener('keydown', (e) => e.stopPropagation());
  card.addEventListener('keyup', (e) => e.stopPropagation());
  ctx.leftStack.append(card);

  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');

  const labels = new THREE.Group();
  labels.name = 'landmark-labels';
  ctx.scene.add(labels);

  let named: NamedMark[] = [];
  let loaded = false;

  function disposeLabels(): void {
    for (let i = labels.children.length - 1; i >= 0; i--) {
      const obj = labels.children[i];
      labels.remove(obj);
      // Sprite.geometry is shared by every THREE.Sprite; only the texture and material are ours.
      if (obj instanceof THREE.Sprite) {
        const material = obj.material;
        if (material.map) material.map.dispose();
        material.map = null;
        material.dispose();
      }
    }
  }

  function renderList(): void {
    const q = search.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    let shown = 0;
    if (loaded) {
      for (let i = 0; i < named.length && shown < MAX_ROWS; i++) {
        const item = named[i];
        const name = item.building.name;
        if (!name) continue;
        if (q && !name.toLowerCase().includes(q)) continue;
        shown++;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'lm-row';
        row.setAttribute('role', 'listitem');
        const nameEl = document.createElement('span');
        nameEl.className = 'lm-name';
        nameEl.textContent = name;
        nameEl.title = name;
        const heightEl = document.createElement('span');
        heightEl.className = 'lm-h';
        heightEl.textContent = formatMeters(item.building.h);
        row.append(nameEl, heightEl);
        row.addEventListener('click', () => {
          ctx.teleport(item.cx, item.cz + SOUTH_M);
          window.dispatchEvent(new CustomEvent<Building>('plateau:focus', { detail: item.building }));
        });
        frag.append(row);
      }
    }
    if (shown === 0) {
      const empty = document.createElement('p');
      empty.className = 'lm-empty';
      empty.textContent = loaded ? '該当する建物がありません' : '読み込み中…';
      frag.append(empty);
    }
    list.replaceChildren(frag);
  }

  function buildLabels(): void {
    if (!measure) return;
    let made = 0;
    for (let i = 0; i < named.length && made < MAX_LABELS; i++) {
      const item = named[i];
      const name = item.building.name;
      if (!name || item.building.fp.length < 6) continue;
      const pill = makePill(measure, name);
      if (!pill) continue;
      made++;
      const material = new THREE.SpriteMaterial({
        map: pill.texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        sizeAttenuation: true,
        fog: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(item.cx, item.building.h + LABEL_Y_LIFT, item.cz);
      sprite.scale.set(LABEL_WORLD_H * pill.aspect, LABEL_WORLD_H, 1);
      sprite.center.set(0.5, 0);
      labels.add(sprite);
    }
  }

  function onAreaLoaded(area: AreaData): void {
    disposeLabels();
    const next: NamedMark[] = [];
    const buildings = area.buildings;
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      if (!building.name) continue;
      const c = footprintCentroid(building.fp);
      next.push({ building, cx: c.x, cz: c.z });
    }
    next.sort((a, b) => b.building.h - a.building.h);
    named = next;
    loaded = true;
    renderList();
    buildLabels();
  }

  search.addEventListener('input', () => renderList());
  renderList();

  return { onAreaLoaded };
};
