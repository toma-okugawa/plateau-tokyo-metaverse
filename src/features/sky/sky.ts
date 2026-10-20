import * as THREE from 'three';
import type { Feature, FeatureFactory } from '../../types';
import './sky.css';

const NOOP_RAYCAST = (): void => {};

interface SkyPalette {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  sunGlowStrength: number;
}

const KEYFRAMES: { hour: number; palette: SkyPalette }[] = [
  {
    // 0:00 Deep night
    hour: 0,
    palette: {
      zenith: new THREE.Color('#040917'),
      mid: new THREE.Color('#09162e'),
      horizon: new THREE.Color('#102342'),
      sunColor: new THREE.Color('#7aa8d6'),
      hemiSky: new THREE.Color('#1d355e'),
      hemiGround: new THREE.Color('#0a1324'),
      sunIntensity: 0.28,
      hemiIntensity: 0.42,
      sunGlowStrength: 0.05,
    },
  },
  {
    // 4:30 Pre-dawn
    hour: 4.5,
    palette: {
      zenith: new THREE.Color('#0a1633'),
      mid: new THREE.Color('#1c2d54'),
      horizon: new THREE.Color('#394872'),
      sunColor: new THREE.Color('#95b4db'),
      hemiSky: new THREE.Color('#324873'),
      hemiGround: new THREE.Color('#162138'),
      sunIntensity: 0.32,
      hemiIntensity: 0.5,
      sunGlowStrength: 0.18,
    },
  },
  {
    // 6:00 Sunrise (warm peach-pink-lavender)
    hour: 6.0,
    palette: {
      zenith: new THREE.Color('#5a75ab'),
      mid: new THREE.Color('#d7a5c4'),
      horizon: new THREE.Color('#f7b594'),
      sunColor: new THREE.Color('#ffbe8f'),
      hemiSky: new THREE.Color('#f2c7cf'),
      hemiGround: new THREE.Color('#8ea7c4'),
      sunIntensity: 0.95,
      hemiIntensity: 1.1,
      sunGlowStrength: 0.95,
    },
  },
  {
    // 8:00 Crisp morning aqua
    hour: 8.0,
    palette: {
      zenith: new THREE.Color('#7cd6ee'),
      mid: new THREE.Color('#bfeaf6'),
      horizon: new THREE.Color('#e6f5fa'),
      sunColor: new THREE.Color('#fff9ee'),
      hemiSky: new THREE.Color('#ffffff'),
      hemiGround: new THREE.Color('#bfe6f2'),
      sunIntensity: 1.25,
      hemiIntensity: 1.45,
      sunGlowStrength: 0.55,
    },
  },
  {
    // 13:00 Bright airy aqua-white day
    hour: 13.0,
    palette: {
      zenith: new THREE.Color('#8ee0f5'),
      mid: new THREE.Color('#c7eef9'),
      horizon: new THREE.Color('#e6f5fa'),
      sunColor: new THREE.Color('#ffffff'),
      hemiSky: new THREE.Color('#ffffff'),
      hemiGround: new THREE.Color('#bfe6f2'),
      sunIntensity: 1.4,
      hemiIntensity: 1.6,
      sunGlowStrength: 0.45,
    },
  },
  {
    // 16:20 Late afternoon
    hour: 16.3,
    palette: {
      zenith: new THREE.Color('#7bcce6'),
      mid: new THREE.Color('#cde8f2'),
      horizon: new THREE.Color('#f2e8df'),
      sunColor: new THREE.Color('#ffeac9'),
      hemiSky: new THREE.Color('#f7f2eb'),
      hemiGround: new THREE.Color('#b5d8e6'),
      sunIntensity: 1.2,
      hemiIntensity: 1.35,
      sunGlowStrength: 0.65,
    },
  },
  {
    // 17:48 (17.8) Sunset (warm peach-pink-lavender)
    hour: 17.8,
    palette: {
      zenith: new THREE.Color('#475c96'),
      mid: new THREE.Color('#c98fb8'),
      horizon: new THREE.Color('#f59a7e'),
      sunColor: new THREE.Color('#ff9d6e'),
      hemiSky: new THREE.Color('#e6a8c0'),
      hemiGround: new THREE.Color('#667399'),
      sunIntensity: 0.9,
      hemiIntensity: 1.0,
      sunGlowStrength: 1.0,
    },
  },
  {
    // 19:15 Dusk
    hour: 19.25,
    palette: {
      zenith: new THREE.Color('#132247'),
      mid: new THREE.Color('#313e6e'),
      horizon: new THREE.Color('#6b5b82'),
      sunColor: new THREE.Color('#8fb2de'),
      hemiSky: new THREE.Color('#425682'),
      hemiGround: new THREE.Color('#1a2640'),
      sunIntensity: 0.4,
      hemiIntensity: 0.6,
      sunGlowStrength: 0.25,
    },
  },
  {
    // 21:00 Night (deep navy)
    hour: 21.0,
    palette: {
      zenith: new THREE.Color('#040917'),
      mid: new THREE.Color('#09162e'),
      horizon: new THREE.Color('#102342'),
      sunColor: new THREE.Color('#7aa8d6'),
      hemiSky: new THREE.Color('#1d355e'),
      hemiGround: new THREE.Color('#0a1324'),
      sunIntensity: 0.28,
      hemiIntensity: 0.42,
      sunGlowStrength: 0.05,
    },
  },
  {
    // 24:00 Wrap to 0:00
    hour: 24.0,
    palette: {
      zenith: new THREE.Color('#040917'),
      mid: new THREE.Color('#09162e'),
      horizon: new THREE.Color('#102342'),
      sunColor: new THREE.Color('#7aa8d6'),
      hemiSky: new THREE.Color('#1d355e'),
      hemiGround: new THREE.Color('#0a1324'),
      sunIntensity: 0.28,
      hemiIntensity: 0.42,
      sunGlowStrength: 0.05,
    },
  },
];

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunGlowStrength;

  varying vec3 vWorldDir;

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = clamp(dir.y, 0.0, 1.0);

    // Smooth vertical gradient: horizon -> mid -> zenith
    vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
    col = mix(col, uZenithColor, smoothstep(0.22, 0.88, h));

    // Subtle below-horizon ground reflection blend
    float below = clamp(-dir.y, 0.0, 1.0);
    col = mix(col, uHorizonColor * 0.9, smoothstep(0.0, 0.25, below));

    // Soft sun disc + atmospheric glow
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float wideGlow = pow(sunDot, 6.0) * 0.35;
    float tightGlow = pow(sunDot, 48.0) * 0.55;
    float sunCore = smoothstep(0.9982, 0.9997, sunDot) * 0.9;
    col += uSunColor * (wideGlow + tightGlow + sunCore) * uSunGlowStrength;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uStarOpacity;
  uniform float uPixelRatio;
  varying float vAlpha;

  void main() {
    float twinkle = 0.72 + 0.28 * sin(uTime * 1.8 + aPhase);
    vAlpha = uStarOpacity * twinkle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(aSize * uPixelRatio, 2.0); // stars sit at a fixed distance: constant pixel size
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.005) discard;
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vec3(0.88, 0.96, 1.0), core * vAlpha);
  }
`;

const WINDOW_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WINDOW_FRAGMENT_SHADER = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    if (uIntensity <= 0.005) discard;

    // Exclude roofs and horizontal surfaces
    vec3 n = normalize(vWorldNormal);
    if (n.y > 0.5 || abs(n.y) > 0.5) discard;

    // Keep ground floor lobby margin dark
    if (vWorldPos.y < 2.4) discard;

    // Dominant horizontal axis of the face normal selects wall coordinate
    float wallCoord = (abs(n.x) > abs(n.z)) ? vWorldPos.z : vWorldPos.x;
    float wallFaceSeed = (abs(n.x) > abs(n.z))
      ? floor(vWorldPos.x * 0.15) + sign(n.x) * 13.0
      : floor(vWorldPos.z * 0.15) + sign(n.z) * 29.0;

    float floorY = vWorldPos.y / 3.8;
    float colX = wallCoord / 3.0;

    float floorIdx = floor(floorY);
    float colIdx = floor(colX);

    vec2 cellUV = vec2(fract(colX), fract(floorY));

    // Window pane frame margins inside each 3.0m x 3.8m cell
    float maskX = smoothstep(0.18, 0.23, cellUV.x) * (1.0 - smoothstep(0.77, 0.82, cellUV.x));
    float maskY = smoothstep(0.22, 0.28, cellUV.y) * (1.0 - smoothstep(0.76, 0.82, cellUV.y));
    float paneMask = maskX * maskY;
    if (paneMask <= 0.01) discard;

    // Pseudo-random per-window on/off and floor-level clustering
    float floorRand = hash21(vec2(floorIdx, wallFaceSeed));
    float winRand = hash21(vec2(colIdx + wallFaceSeed * 3.1, floorIdx * 1.7 + wallFaceSeed));

    float threshold = mix(0.45, 0.72, floorRand);
    if (winRand < threshold) discard;

    // Color palette: warm white / amber windows + a few aqua accent windows
    float colorSeed = hash21(vec2(colIdx * 2.3 + 7.1, floorIdx * 3.7 + wallFaceSeed));
    vec3 warmWhite = vec3(1.0, 0.93, 0.78);
    vec3 warmAmber = vec3(1.0, 0.74, 0.42);
    vec3 aquaGlow = vec3(0.15, 0.85, 0.98);

    vec3 winColor;
    if (colorSeed > 0.87) {
      winColor = aquaGlow;
    } else {
      winColor = mix(warmAmber, warmWhite, clamp(colorSeed / 0.87, 0.0, 1.0));
    }

    float brightness = (0.55 + 0.45 * fract(winRand * 9.7)) * paneMask * uIntensity;
    gl_FragColor = vec4(winColor * brightness, brightness);
  }
`;

function formatTimeLabel(hour: number): string {
  const wrapped = ((hour % 24) + 24) % 24;
  let h = Math.floor(wrapped);
  let m = Math.round((wrapped - h) * 60);
  if (m >= 60) {
    h = (h + 1) % 24;
    m = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const createSky: FeatureFactory = (ctx): Feature => {
  let timeHours = 13.0;
  let isPlaying = false;

  // ---------- UI Card ----------
  const card = document.createElement('div');
  card.className = 'card sky-card';

  const header = document.createElement('div');
  header.className = 'sky-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'sky-title';
  titleEl.textContent = '時間帯';

  const timeBadge = document.createElement('span');
  timeBadge.className = 'sky-time-badge';
  timeBadge.textContent = formatTimeLabel(timeHours);

  header.append(titleEl, timeBadge);

  const sliderRow = document.createElement('div');
  sliderRow.className = 'sky-slider-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'sky-slider';
  slider.min = '0';
  slider.max = '24';
  slider.step = '0.1';
  slider.value = String(timeHours);
  slider.setAttribute('aria-label', '時間帯スライダー');

  sliderRow.appendChild(slider);

  const controlsRow = document.createElement('div');
  controlsRow.className = 'sky-controls';

  const presets: { label: string; hour: number }[] = [
    { label: '朝', hour: 6 },
    { label: '昼', hour: 13 },
    { label: '夕', hour: 17.8 },
    { label: '夜', hour: 21 },
  ];

  const presetButtons: { btn: HTMLButtonElement; hour: number }[] = [];

  function syncUI(): void {
    slider.value = timeHours.toFixed(1);
    timeBadge.textContent = formatTimeLabel(timeHours);
    for (const p of presetButtons) {
      const diff = Math.min(
        Math.abs(timeHours - p.hour),
        Math.abs(timeHours - 24 - p.hour),
        Math.abs(timeHours + 24 - p.hour)
      );
      p.btn.classList.toggle('active', diff < 0.25);
    }
  }

  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sky-preset-btn';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      timeHours = preset.hour;
      syncUI();
      applyAtmosphere(timeHours);
    });
    presetButtons.push({ btn, hour: preset.hour });
    controlsRow.appendChild(btn);
  }

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'sky-play-btn';
  playBtn.textContent = '▶ 再生';
  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    playBtn.classList.toggle('active', isPlaying);
    playBtn.textContent = isPlaying ? '⏸ 停止' : '▶ 再生';
  });
  controlsRow.appendChild(playBtn);

  slider.addEventListener('input', () => {
    timeHours = parseFloat(slider.value) || 0;
    syncUI();
    applyAtmosphere(timeHours);
  });

  card.append(header, sliderRow, controlsRow);
  ctx.leftStack.appendChild(card);

  // ---------- Sky Dome + Stars ----------
  const skyGroup = new THREE.Group();
  ctx.scene.add(skyGroup);

  const skyUniforms = {
    uZenithColor: { value: new THREE.Color('#8ee0f5') },
    uMidColor: { value: new THREE.Color('#c7eef9') },
    uHorizonColor: { value: new THREE.Color('#e6f5fa') },
    uSunColor: { value: new THREE.Color('#ffffff') },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunGlowStrength: { value: 0.45 },
  };

  const skyGeo = new THREE.SphereGeometry(3500, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -100;
  skyDome.raycast = NOOP_RAYCAST;
  skyGroup.add(skyDome);

  // ~1500 stars on the upper dome
  const STAR_COUNT = 1500;
  const starPositions = new Float32Array(STAR_COUNT * 3);
  const starSizes = new Float32Array(STAR_COUNT);
  const starPhases = new Float32Array(STAR_COUNT);
  const starRadius = 3350;

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    // Bias slightly above horizon (y > 0.04)
    const u = 0.04 + Math.random() * 0.96;
    const sinPhi = Math.sqrt(Math.max(0, 1 - u * u));
    starPositions[i * 3] = starRadius * sinPhi * Math.cos(theta);
    starPositions[i * 3 + 1] = starRadius * u;
    starPositions[i * 3 + 2] = starRadius * sinPhi * Math.sin(theta);
    starSizes[i] = 1.6 + Math.random() * 2.8;
    starPhases[i] = Math.random() * Math.PI * 2;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));

  const starUniforms = {
    uTime: { value: 0 },
    uStarOpacity: { value: 0 },
    uPixelRatio: { value: ctx.renderer.getPixelRatio() },
  };

  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -99;
  stars.raycast = NOOP_RAYCAST;
  skyGroup.add(stars);

  // ---------- Night City Window Overlays ----------
  const windowGroup = new THREE.Group();
  ctx.scene.add(windowGroup);

  const windowUniforms = {
    uIntensity: { value: 0.0 },
  };

  const sharedWindowMaterial = new THREE.ShaderMaterial({
    vertexShader: WINDOW_VERTEX_SHADER,
    fragmentShader: WINDOW_FRAGMENT_SHADER,
    uniforms: windowUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });

  function buildWindowOverlays(): void {
    // Clear previous overlay meshes without disposing shared chunk geometries or sharedWindowMaterial
    while (windowGroup.children.length > 0) {
      windowGroup.remove(windowGroup.children[windowGroup.children.length - 1]);
    }

    // one overlay per merged render chunk (not per building) keeps the night city at ~40 draw calls
    const chunks = ctx.getRenderChunks();
    for (let i = 0; i < chunks.length; i++) {
      const m = chunks[i];
      const overlay = new THREE.Mesh(m.geometry, sharedWindowMaterial);
      overlay.position.copy(m.position);
      overlay.rotation.copy(m.rotation);
      overlay.scale.copy(m.scale);
      overlay.raycast = NOOP_RAYCAST;
      windowGroup.add(overlay);
    }
  }

  // ---------- Pre-allocated Scratch Objects (No per-frame allocations) ----------
  const sunDirection = new THREE.Vector3();
  const solarVisualDir = new THREE.Vector3();

  function applyAtmosphere(hour: number): void {
    const h = ((hour % 24) + 24) % 24;

    // Find surrounding keyframes
    let idx = 0;
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (h >= KEYFRAMES[i].hour && h <= KEYFRAMES[i + 1].hour) {
        idx = i;
        break;
      }
    }
    const k0 = KEYFRAMES[idx];
    const k1 = KEYFRAMES[idx + 1];
    const span = Math.max(0.0001, k1.hour - k0.hour);
    const alpha = THREE.MathUtils.smoothstep((h - k0.hour) / span, 0, 1);

    skyUniforms.uZenithColor.value.lerpColors(k0.palette.zenith, k1.palette.zenith, alpha);
    skyUniforms.uMidColor.value.lerpColors(k0.palette.mid, k1.palette.mid, alpha);
    skyUniforms.uHorizonColor.value.lerpColors(k0.palette.horizon, k1.palette.horizon, alpha);
    skyUniforms.uSunColor.value.lerpColors(k0.palette.sunColor, k1.palette.sunColor, alpha);
    skyUniforms.uSunGlowStrength.value = THREE.MathUtils.lerp(
      k0.palette.sunGlowStrength,
      k1.palette.sunGlowStrength,
      alpha
    );

    // Sync scene.background and scene.fog with horizon colour
    if (ctx.scene.background instanceof THREE.Color) {
      ctx.scene.background.copy(skyUniforms.uHorizonColor.value);
    } else {
      ctx.scene.background = skyUniforms.uHorizonColor.value.clone();
    }
    if (ctx.scene.fog instanceof THREE.Fog) {
      ctx.scene.fog.color.copy(skyUniforms.uHorizonColor.value);
    }

    // Update hemisphere and directional lights
    ctx.hemi.color.lerpColors(k0.palette.hemiSky, k1.palette.hemiSky, alpha);
    ctx.hemi.groundColor.lerpColors(k0.palette.hemiGround, k1.palette.hemiGround, alpha);
    ctx.hemi.intensity = THREE.MathUtils.lerp(k0.palette.hemiIntensity, k1.palette.hemiIntensity, alpha);

    ctx.sun.color.copy(skyUniforms.uSunColor.value);
    ctx.sun.intensity = THREE.MathUtils.lerp(k0.palette.sunIntensity, k1.palette.sunIntensity, alpha);

    // Solar orbit: 6:00 east (+x), 12:00 high south (+y, +z), 18:00 west (-x)
    const solarAngle = ((h - 6.0) / 24.0) * Math.PI * 2.0;
    const rawElev = Math.sin(solarAngle);
    const rawEast = Math.cos(solarAngle);
    const southOffset = 0.38;

    solarVisualDir.set(rawEast, rawElev, southOffset).normalize();
    skyUniforms.uSunDir.value.copy(solarVisualDir);

    // For directional light, keep elevation above horizon at night for cool moonlight shadows
    // continuous sun -> moon hand-over so shadows never snap at dawn / dusk
    const lightElev = Math.max(0.28, rawElev >= 0 ? rawElev : -rawElev * 0.65);
    const sunW = THREE.MathUtils.smoothstep(rawElev, -0.12, 0.08); // 0 = moon, 1 = sun
    const lightEast = THREE.MathUtils.lerp(-rawEast * 0.6, rawEast, sunW);
    sunDirection.set(lightEast, lightElev, southOffset).normalize();

    // Night factor for stars & building windows (0 by day, fades to 1 at night)
    const nightFactor = THREE.MathUtils.clamp((-rawElev + 0.08) / 0.36, 0.0, 1.0);
    const smoothNight = nightFactor * nightFactor * (3.0 - 2.0 * nightFactor);

    starUniforms.uStarOpacity.value = smoothNight;
    stars.visible = smoothNight > 0.005;

    windowUniforms.uIntensity.value = smoothNight;
    windowGroup.visible = smoothNight > 0.005;
  }

  // Initial setup
  syncUI();
  applyAtmosphere(timeHours);

  if (ctx.getRenderChunks().length > 0) buildWindowOverlays();

  return {
    onAreaLoaded(): void {
      buildWindowOverlays();
    },
    update(dt: number, t: number): void {
      if (isPlaying) {
        // Auto-advance time: 1 hour per 3 seconds
        timeHours = (timeHours + dt / 3.0) % 24.0;
        syncUI();
        applyAtmosphere(timeHours);
      }

      starUniforms.uTime.value = t;

      // Sky dome and stars follow camera position
      skyGroup.position.copy(ctx.camera.position);

      // Orbit sun relative to avatar (runs AFTER main.ts moved the sun)
      // far enough that low sunrise / sunset light still reaches the tops of 250 m towers
      ctx.sun.position.copy(ctx.avatar.position).addScaledVector(sunDirection, 1400);
      ctx.sun.target.position.copy(ctx.avatar.position);
    },
  };
};
