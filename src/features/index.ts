import type { FeatureFactory } from '../types';
import { createFlood } from './flood/flood';
import { createSky } from './sky/sky';

/** Feature modules plugged into the world (see src/types.ts for the contract). */
export const FEATURES: FeatureFactory[] = [createSky, createFlood];
