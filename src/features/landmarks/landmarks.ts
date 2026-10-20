import type { AreaData, Building, FeatureFactory } from '../../types';
import './landmarks.css';

const MAX_ROWS = 40;
/** teleport this far south of a landmark so it is in view */
const SOUTH_M = 40;

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
  ctx.leftStack.append(card);

  let named: NamedMark[] = [];
  let loaded = false;

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
          // look at the landmark from the south, keeping the current orbit distance
          const d = Math.max(60, ctx.camera.position.distanceTo(ctx.avatar.position));
          ctx.camera.position.set(ctx.avatar.position.x, ctx.avatar.position.y + d * 0.45, ctx.avatar.position.z + d * 0.89);
          window.dispatchEvent(new CustomEvent<Building>('plateau:focus', { detail: item.building }));
          row.blur(); // keys go back to the world (Space must not re-activate this row)
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

  function onAreaLoaded(area: AreaData): void {
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
  }

  search.addEventListener('input', () => renderList());
  renderList();

  return { onAreaLoaded };
};
