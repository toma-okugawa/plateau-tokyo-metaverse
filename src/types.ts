import type * as THREE from 'three';

/** One PLATEAU building converted by scripts/convert_citygml.py */
export interface Building {
  id: string;
  name?: string;
  /** measured height (m) */
  h: number;
  /** ground elevation of the footprint (m, T.P.) */
  b: number;
  /** footprint ring, flat [x0, z0, x1, z1, ...] in local meters (x = east, z = south) */
  fp: number[];
  usage?: string;
  floors?: number;
  basement?: number;
  year?: number;
  structure?: string;
  /** max expected river-flood inundation depth (m) from PLATEAU flood risk attributes */
  flood?: number;
  /** PLATEAU inundation rank code (1: <0.5m, 2: 0.5-3m, 3: 3-5m, 4: 5-10m, 5: 10-20m, 6: >=20m) */
  floodRank?: number;
  /** river whose flooding scenario produced `flood` */
  floodRiver?: string;
  area?: number;
  /** LOD2 mesh: positions [x, y, z, ...] in decimeters (y = height above b), triangle indices */
  g?: { p: number[]; i: number[] };
}

export interface AreaData {
  id: string;
  name: string;
  origin: { lat: number; lon: number };
  source: string;
  count: number;
  buildings: Building[];
}

/**
 * Shared world handle passed to every feature module.
 * Coordinates: x = east (m), y = up (m), z = south (m), origin = area origin, ground at y = 0.
 */
export interface WorldContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** player avatar; avatar.position is the player's feet position (y > 0 while floating) */
  avatar: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /**
   * One proxy mesh per building (mesh.userData.building is a Building), used for picking and analysis.
   * Proxies are NOT added to the scene and share one material; geometry is in world coordinates.
   */
  getBuildings(): THREE.Mesh[];
  /** the visible city: buildings merged into spatial chunks (world-space geometry with normals) */
  getRenderChunks(): THREE.Mesh[];
  getArea(): AreaData | null;
  /** move avatar (and camera) to local x/z (snapped to the nearest free street spot) */
  teleport(x: number, z: number): void;
  /** vertical stack container on the left side for feature panels (append `.card` elements) */
  leftStack: HTMLElement;
}

export interface Feature {
  /** called every frame */
  update?(dt: number, t: number): void;
  /** called after an area's buildings were (re)built */
  onAreaLoaded?(area: AreaData, meshes: THREE.Mesh[]): void;
}

export type FeatureFactory = (ctx: WorldContext) => Feature;
