/**
 * Seeded particle fields for the weather scenes (HelloView / WeatherDetail).
 * Fields are generated once per scene — never call from markup expressions
 * (Svelte re-renders would re-roll the random values and jitter the scene).
 */

export interface Particle {
  left: number;
  delay: number;
  duration: number;
  opacity: number;
  size: number;
  drift: number;
}

/** Depth layers: 0 = far, 1 = mid, 2 = near. */
export type ParticleLayer = [Particle[], Particle[], Particle[]];

/** Empty layer set for scenes without rain/snow. */
export const EMPTY_LAYERS: ParticleLayer = [[], [], []];

export const LAYER_NAMES = ["far", "mid", "near"] as const;

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LayerRange {
  dur: [number, number];
  op: [number, number];
  size: [number, number];
  drift: [number, number];
}

const RAIN_LAYERS: LayerRange[] = [
  { dur: [1.05, 1.55], op: [0.16, 0.32], size: [1.0, 1.4], drift: [4, 9] },
  { dur: [0.72, 1.02], op: [0.3, 0.52], size: [1.3, 1.8], drift: [8, 16] },
  { dur: [0.5, 0.72], op: [0.46, 0.75], size: [1.8, 2.5], drift: [11, 23] },
];

const RAIN_HEAVY_LAYERS: LayerRange[] = [
  { dur: [0.55, 0.8], op: [0.2, 0.38], size: [1.2, 1.7], drift: [5, 11] },
  { dur: [0.38, 0.56], op: [0.36, 0.58], size: [1.7, 2.3], drift: [9, 19] },
  { dur: [0.26, 0.4], op: [0.52, 0.82], size: [2.2, 3.1], drift: [13, 26] },
];

const SNOW_LAYERS: LayerRange[] = [
  { dur: [7.5, 11], op: [0.22, 0.4], size: [2.6, 4.2], drift: [8, 18] },
  { dur: [5.5, 8], op: [0.38, 0.58], size: [4, 6.5], drift: [14, 30] },
  { dur: [3.6, 5.6], op: [0.55, 0.8], size: [6, 10], drift: [20, 44] },
];

const LAYER_MIX = [0.38, 0.34, 0.28];

function buildLayers(count: number, ranges: LayerRange[], rnd: () => number): ParticleLayer {
  const layers: ParticleLayer = [[], [], []];
  const counts = [
    Math.round(count * LAYER_MIX[0]),
    Math.round(count * LAYER_MIX[1]),
    0,
  ];
  counts[2] = Math.max(0, count - counts[0] - counts[1]);
  for (let li = 0; li < 3; li++) {
    const r = ranges[li];
    for (let i = 0; i < counts[li]; i++) {
      layers[li].push({
        left: rnd() * 100,
        delay: rnd() * 5.5,
        duration: r.dur[0] + rnd() * (r.dur[1] - r.dur[0]),
        opacity: r.op[0] + rnd() * (r.op[1] - r.op[0]),
        size: r.size[0] + rnd() * (r.size[1] - r.size[0]),
        drift: (r.drift[0] + rnd() * (r.drift[1] - r.drift[0])) * (rnd() < 0.5 ? -1 : 1),
      });
    }
  }
  return layers;
}

/** Rain (or heavy storm rain) in three depth layers — far is fine and slow, near is long and fast. */
export function makeRainLayers(count: number, heavy = false): ParticleLayer {
  return buildLayers(count, heavy ? RAIN_HEAVY_LAYERS : RAIN_LAYERS, mulberry32(heavy ? 0x51fa : 0x2c81));
}

/** Snow in three depth layers — matte flakes with per-layer size, speed and sway amplitude. */
export function makeSnowLayers(count: number): ParticleLayer {
  return buildLayers(count, SNOW_LAYERS, mulberry32(0x7e11));
}

export function makeClouds(count: number): Particle[] {
  const rnd = mulberry32(0x3a09);
  return Array.from({ length: count }, () => ({
    left: rnd() * 70,
    delay: rnd() * 18,
    duration: 28 + rnd() * 22,
    opacity: 0.15 + rnd() * 0.2,
    size: 150 + rnd() * 150,
    drift: 0,
  }));
}

export function makeFog(count: number): Particle[] {
  const rnd = mulberry32(0x1f55);
  return Array.from({ length: count }, () => ({
    left: rnd() * 60,
    delay: rnd() * 10,
    duration: 16 + rnd() * 14,
    opacity: 0.11 + rnd() * 0.15,
    size: 190 + rnd() * 170,
    drift: 0,
  }));
}
