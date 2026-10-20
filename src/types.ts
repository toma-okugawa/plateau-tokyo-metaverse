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
  area?: number;
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
  /** player avatar; avatar.position is the player's feet position */
  avatar: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** current building meshes; mesh.userData.building is a Building. Do NOT change their materials. */
  getBuildings(): THREE.Mesh[];
  getArea(): AreaData | null;
  /** move avatar (and camera) to local x/z */
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
