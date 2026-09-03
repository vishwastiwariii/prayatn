/**
 * Seeded pseudo-random generator (mulberry32). Deterministic: the same seed
 * always yields the same stream. Used for dataset generation and for every
 * "coin flip" inside the hidden-state simulator, so a whole experiment is
 * reproducible from a single integer.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Pick one element (uniform). */
  pick<T>(items: readonly T[]): T;
  /** Pick one element by weight. `weights[i]` corresponds to `items[i]`. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** A fresh independent stream, deterministically derived from this one. */
  fork(label: string): Rng;
}

function hashStringToSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashStringToSeed(seed) : seed >>> 0) || 1;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick: empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items, weights) => {
      if (items.length === 0 || items.length !== weights.length) {
        throw new Error('weighted: items/weights length mismatch');
      }
      const total = weights.reduce((a, b) => a + b, 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        r -= weights[i] as number;
        if (r < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    fork: (label) => createRng((state ^ hashStringToSeed(label)) >>> 0),
  };
  return rng;
}
