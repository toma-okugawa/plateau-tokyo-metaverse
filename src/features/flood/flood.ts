import * as THREE from 'three';
import type { AreaData, Building, FeatureFactory } from '../../types';
import './flood.css';

const MAX_LEVEL = 10;
const LEVEL_STEPS = MAX_LEVEL * 10;
const MARGIN = 300;
const RISE_SPEED = 0.5; // metres per second; one full cycle takes 40 seconds.

const DEPTH_PALETTE = [
  { max: 0.5, color: '#f7f5a9', label: '0.5 m未満' },
  { max: 3, color: '#ffd8c0', label: '0.5〜3 m未満' },
  { max: 5, color: '#ffb7b7', label: '3〜5 m未満' },
  { max: 10, color: '#ff9191', label: '5〜10 m未満' },
  { max: 20, color: '#f285c9', label: '10〜20 m未満' },
  { max: Infinity, color: '#dc7adc', label: '20 m以上' },
] as const;

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vSurfaceUv;
  #include <fog_pars_vertex>
  void main() {
    vSurfaceUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uWaterColor;
  uniform vec3 uSkyColor;
  varying vec3 vWorldPosition;
  varying vec2 vSurfaceUv;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorldPosition.xz;
    vec2 d1 = vec2(0.83, 0.55);
    vec2 d2 = vec2(-0.43, 0.90);
    float w1 = dot(p, d1) * 0.12 + uTime * 0.85;
    float w2 = dot(p, d2) * 0.21 - uTime * 0.62;
    float w3 = (p.x + p.y) * 0.47 + uTime * 1.15;
    vec2 slope = d1 * 0.065 * cos(w1)
               + d2 * 0.045 * cos(w2)
               + vec2(0.018) * cos(w3);
    vec3 surfaceNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    if (!gl_FrontFacing) surfaceNormal = -surfaceNormal;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(surfaceNormal, viewDirection), 0.0), 3.0);
    float specular = pow(max(dot(reflect(-uSunDirection, surfaceNormal), viewDirection), 0.0), 72.0);
    float sparkle = pow(max(sin(w3) * cos(w2 * 1.7), 0.0), 14.0);
    float ripples = 0.5 + 0.5 * sin(w1 + 0.45 * sin(w2));
    vec3 color = mix(uWaterColor, uSkyColor, 0.18 + fresnel * 0.52);
    color += vec3(0.035 * ripples + specular * 0.38 + sparkle * 0.055);
    float edge = min(min(vSurfaceUv.x, 1.0 - vSurfaceUv.x), min(vSurfaceUv.y, 1.0 - vSurfaceUv.y));
    float alpha = (0.30 + fresnel * 0.18 + ripples * 0.035) * smoothstep(0.0, 0.025, edge);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const MARKER_VERTEX = /* glsl */ `
  attribute float aFloodDepth;
  varying vec3 vMarkerColor;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vHeight;
  varying float vPhase;
  #include <fog_pars_vertex>
  void main() {
    vMarkerColor = instanceColor;
    vDepth = aFloodDepth;
    vHeight = position.y + 0.5;
    vPhase = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.019;
    // Instances only scale vertically; cylinder side/cap normals keep their direction.
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  varying vec3 vMarkerColor;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vHeight;
  varying float vPhase;
  #include <fog_pars_fragment>
  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 2.0);
    float isActive = step(uLevel, vDepth); // 'active' is reserved in GLSL ES 3.00
    float pulse = isActive * (0.5 + 0.5 * sin(uTime * 1.8 + vPhase));
    float cap = smoothstep(0.88, 1.0, vHeight);
    vec3 color = mix(vMarkerColor, vec3(1.0), 0.05 + 0.13 * rim + 0.10 * pulse);
    float alpha = 0.24 + 0.22 * rim + 0.09 * cap + 0.13 * pulse;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Polygon area centroid, with a vertex mean for degenerate footprints. */
function footprintCentroid(building: Building, target: THREE.Vector2): boolean {
  const fp = building.fp;
  let count = Math.floor(fp.length / 2);
  if (count < 3 || fp.length % 2 !== 0) return false;
  if (fp[0] === fp[(count - 1) * 2] && fp[1] === fp[(count - 1) * 2 + 1]) count--;
  if (count < 3) return false;

  const originX = fp[0];
  const originZ = fp[1];
  let twiceArea = 0;
  let weightedX = 0;
  let weightedZ = 0;
  let meanX = 0;
  let meanZ = 0;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const x = fp[i * 2] - originX;
    const z = fp[i * 2 + 1] - originZ;
    const nx = fp[next * 2] - originX;
    const nz = fp[next * 2 + 1] - originZ;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const cross = x * nz - nx * z;
    twiceArea += cross;
    weightedX += (x + nx) * cross;
    weightedZ += (z + nz) * cross;
    meanX += x;
    meanZ += z;
  }
  if (Math.abs(twiceArea) > 1e-8) {
    target.set(originX + weightedX / (3 * twiceArea), originZ + weightedZ / (3 * twiceArea));
  } else {
    target.set(originX + meanX / count, originZ + meanZ / count);
  }
  return Number.isFinite(target.x) && Number.isFinite(target.y);
}

export const createFlood: FeatureFactory = (ctx) => {
  const card = document.createElement('section');
  card.className = 'card flood-card';
  card.setAttribute('aria-label', '洪水シミュレーション');
  card.innerHTML = `
    <div class="flood-header">
      <h2 class="flood-title">洪水シミュレーション</h2>
      <button type="button" class="flood-toggle" aria-label="洪水シミュレーションの表示" aria-pressed="false">
        <span class="flood-toggle-dot" aria-hidden="true"></span><span class="flood-toggle-text">OFF</span>
      </button>
    </div>
    <label class="flood-level-control">
      <span class="flood-level-row"><span>水位</span><output class="flood-level-value">0.0 m</output></span>
      <input class="flood-slider" type="range" min="0" max="10" step="0.1" value="0" aria-label="水位（メートル）" aria-valuetext="0.0 m">
    </label>
    <div class="flood-scale" aria-hidden="true"><span>0 m</span><span>10 m</span></div>
    <div class="flood-playback">
      <button type="button" class="flood-play" aria-pressed="false">▶ 再生</button>
      <span class="flood-cycle">0 → 10 → 0 m</span>
    </div>
    <div class="flood-stats">
      <p><span>浸水想定区域内の建物:</span> <strong class="flood-total">0</strong> 棟</p>
      <p><span>現在の水位以上の想定浸水深:</span> <strong class="flood-current">0</strong> 棟</p>
    </div>
    <div class="flood-legend">
      <div class="flood-legend-title">想定最大浸水深（国土交通省の配色）</div>
      <ul class="flood-legend-items">${DEPTH_PALETTE.map((entry) =>
        `<li><span class="flood-swatch" style="background:${entry.color}" aria-hidden="true"></span><span>${entry.label}</span></li>`
      ).join('')}</ul>
    </div>
    <p class="flood-note">水面は一律の高さ、柱は建物ごとの想定最大浸水深を表示します（0.5 m以上）。</p>
  `;
  ctx.leftStack.append(card);

  const toggle = card.querySelector<HTMLButtonElement>('.flood-toggle')!;
  const toggleText = card.querySelector<HTMLElement>('.flood-toggle-text')!;
  const slider = card.querySelector<HTMLInputElement>('.flood-slider')!;
  const levelOutput = card.querySelector<HTMLOutputElement>('.flood-level-value')!;
  const playButton = card.querySelector<HTMLButtonElement>('.flood-play')!;
  const totalOutput = card.querySelector<HTMLElement>('.flood-total')!;
  const currentOutput = card.querySelector<HTMLElement>('.flood-current')!;

  // Cache labels/counts outside update(), including during continuous playback.
  const numberFormat = new Intl.NumberFormat('ja-JP');
  const levelValues = Array.from({ length: LEVEL_STEPS + 1 }, (_, i) => (i / 10).toFixed(1));
  const levelLabels = levelValues.map((value) => `${value} m`);
  let sortedDepths: number[] = [];
  let countLabels = ['0'];
  let previousCount = -1;
  let enabled = false;
  let playing = false;
  let levelTick = -1;
  let cyclePosition = 0;

  const group = new THREE.Group();
  group.name = 'flood-simulation';
  group.visible = false;
  ctx.scene.add(group);

  const timeUniform = { value: 0 };
  const levelUniform = { value: 0 };
  const sunUniform = { value: new THREE.Vector3(0.46, 0.77, 0.43) };
  let water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  let markers: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.ShaderMaterial> | null = null;
  const extent = new THREE.Box3();
  const meshExtent = new THREE.Box3();
  const point = new THREE.Vector3();
  const centroid = new THREE.Vector2();
  const instance = new THREE.Object3D();
  const paletteColors = DEPTH_PALETTE.map((entry) => new THREE.Color(entry.color));

  function setPlaying(next: boolean): void {
    playing = next;
    playButton.textContent = next ? 'Ⅱ 一時停止' : '▶ 再生';
    playButton.setAttribute('aria-pressed', next ? 'true' : 'false');
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    group.visible = next;
    toggleText.textContent = next ? 'ON' : 'OFF';
    toggle.setAttribute('aria-pressed', next ? 'true' : 'false');
    card.dataset.enabled = next ? 'true' : 'false';
    if (!next) setPlaying(false);
  }

  function setLevel(level: number): void {
    levelUniform.value = level;
    if (water) {
      water.position.y = level;
      water.visible = level > 0.05; // no water sheet over the whole map at 0 m
    }
    const tick = Math.round(level * 10);
    if (tick !== levelTick) {
      levelTick = tick;
      slider.value = levelValues[tick];
      slider.setAttribute('aria-valuetext', levelLabels[tick]);
      levelOutput.textContent = levelLabels[tick];
    }
    // Lower bound preserves >= semantics, even between the slider's 0.1 m ticks.
    let lower = 0;
    let upper = sortedDepths.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (sortedDepths[middle] < level) lower = middle + 1;
      else upper = middle;
    }
    const count = sortedDepths.length - lower;
    if (count !== previousCount) {
      previousCount = count;
      currentOutput.textContent = countLabels[count];
    }
  }

  toggle.addEventListener('click', () => setEnabled(!enabled));
  playButton.addEventListener('click', () => {
    if (!enabled) setEnabled(true);
    setPlaying(!playing);
  });
  slider.addEventListener('input', () => {
    const next = slider.valueAsNumber;
    if (!Number.isFinite(next)) return;
    setPlaying(false);
    setEnabled(true);
    const tick = Math.round(THREE.MathUtils.clamp(next, 0, MAX_LEVEL) * 10);
    cyclePosition = tick / 10;
    setLevel(tick / 10);
  });

  function clearAreaObjects(): void {
    if (water) {
      group.remove(water);
      water.geometry.dispose();
      water.material.dispose();
      water = null;
    }
    if (markers) {
      group.remove(markers);
      markers.dispose(); // releases the instance matrix/color buffers in three r170.
      markers.geometry.dispose();
      markers.material.dispose();
      markers = null;
    }
  }

  function rebuild(area: AreaData, meshes: THREE.Mesh[]): void {
    clearAreaObjects();
    extent.makeEmpty();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) continue;
      meshExtent.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (Number.isFinite(meshExtent.min.x) && Number.isFinite(meshExtent.min.z)
        && Number.isFinite(meshExtent.max.x) && Number.isFinite(meshExtent.max.z)) extent.union(meshExtent);
    }

    const depths: number[] = [];
    const markerData: { x: number; z: number; depth: number }[] = [];
    const useFootprintExtent = extent.isEmpty();
    for (const building of area.buildings) {
      if (useFootprintExtent) {
        for (let i = 0; i + 1 < building.fp.length; i += 2) {
          const x = building.fp[i];
          const z = building.fp[i + 1];
          if (Number.isFinite(x) && Number.isFinite(z)) extent.expandByPoint(point.set(x, 0, z));
        }
      }
      const depth = building.flood;
      if (depth === undefined || !Number.isFinite(depth) || depth < 0) continue;
      depths.push(depth);
      if (depth >= 0.5 && footprintCentroid(building, centroid)) {
        markerData.push({ x: centroid.x, z: centroid.y, depth });
      }
    }

    sortedDepths = depths.sort((a, b) => a - b);
    countLabels = Array.from({ length: depths.length + 1 }, (_, count) => numberFormat.format(count));
    previousCount = -1;
    totalOutput.textContent = numberFormat.format(depths.length);

    if (extent.isEmpty()) {
      extent.min.set(0, 0, 0);
      extent.max.set(0, 0, 0);
    }
    const waterGeometry = new THREE.PlaneGeometry(
      extent.max.x - extent.min.x + MARGIN * 2,
      extent.max.z - extent.min.z + MARGIN * 2,
    );
    waterGeometry.rotateX(-Math.PI / 2);
    const waterMaterial = new THREE.ShaderMaterial({
      name: 'Flood aqua water',
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: timeUniform,
        uSunDirection: sunUniform,
        uWaterColor: { value: new THREE.Color('#39bddc') },
        uSkyColor: { value: new THREE.Color('#e6f5fa') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      // Avoid fighting with the ground at exactly 0 m.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.name = 'flood-water';
    water.position.set((extent.min.x + extent.max.x) / 2, levelUniform.value, (extent.min.z + extent.max.z) / 2);
    water.renderOrder = 4;
    group.add(water);

    if (markerData.length > 0) {
      const geometry = new THREE.CylinderGeometry(3, 3, 1, 16, 1, false);
      const depthAttribute = new THREE.InstancedBufferAttribute(new Float32Array(markerData.length), 1);
      geometry.setAttribute('aFloodDepth', depthAttribute);
      const material = new THREE.ShaderMaterial({
        name: 'Flood depth columns',
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uTime: timeUniform,
          uLevel: levelUniform,
        },
        transparent: true,
        depthWrite: false,
        // Depth columns sit inside building footprints and must remain readable.
        depthTest: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      markers = new THREE.InstancedMesh(geometry, material, markerData.length);
      markers.name = 'flood-depth-markers';
      markers.renderOrder = 5;
      for (let i = 0; i < markerData.length; i++) {
        const marker = markerData[i];
        instance.position.set(marker.x, marker.depth / 2, marker.z);
        instance.scale.set(1, marker.depth, 1);
        instance.updateMatrix();
        markers.setMatrixAt(i, instance.matrix);
        let paletteIndex = 0;
        while (marker.depth >= DEPTH_PALETTE[paletteIndex].max) paletteIndex++;
        markers.setColorAt(i, paletteColors[paletteIndex]);
        depthAttribute.setX(i, marker.depth);
      }
      markers.instanceMatrix.needsUpdate = true;
      if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
      markers.computeBoundingSphere();
      group.add(markers);
    }
    setLevel(levelUniform.value);
  }

  card.dataset.enabled = 'false';
  setLevel(0);
  const currentArea = ctx.getArea();
  if (currentArea) rebuild(currentArea, ctx.getBuildings());

  return {
    onAreaLoaded: rebuild,
    update(dt, t) {
      if (!enabled) return;
      timeUniform.value = t % 4096;
      sunUniform.value.copy(ctx.sun.position).sub(ctx.sun.target.position).normalize();
      if (playing && Number.isFinite(dt) && dt > 0) {
        cyclePosition = (cyclePosition + dt * RISE_SPEED) % (MAX_LEVEL * 2);
        const nextLevel = cyclePosition <= MAX_LEVEL ? cyclePosition : MAX_LEVEL * 2 - cyclePosition;
        setLevel(nextLevel);
      }
    },
  };
};
