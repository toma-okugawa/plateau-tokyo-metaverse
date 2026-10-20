import type { FeatureFactory } from '../types';
import { createFlood } from './flood/flood';
import { createLandmarks } from './landmarks/landmarks';
import { createMinimap } from './minimap/minimap';
import { createSky } from './sky/sky';

/** Feature modules plugged into the world (see src/types.ts for the contract). */
export const FEATURES: FeatureFactory[] = [createSky, createFlood, createLandmarks, createMinimap];
