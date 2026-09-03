import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds give different streams', () => {
    const a = Array.from({ length: 10 }, () => createRng(1).next());
    const b = Array.from({ length: 10 }, () => createRng(2).next());
    expect(a).not.toEqual(b);
  });

  it('accepts a string seed', () => {
    expect(createRng('hello').next()).toBe(createRng('hello').next());
    expect(createRng('hello').next()).not.toBe(createRng('world').next());
  });

  it('int() stays within inclusive bounds', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const n = r.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('chance() is roughly calibrated', () => {
    const r = createRng(99);
    let hits = 0;
    for (let i = 0; i < 10_000; i += 1) if (r.chance(0.3)) hits += 1;
    expect(hits / 10_000).toBeGreaterThan(0.27);
    expect(hits / 10_000).toBeLessThan(0.33);
  });

  it('weighted() respects the weights', () => {
    const r = createRng(5);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 12_000; i += 1) {
      counts[r.weighted(['a', 'b', 'c'] as const, [80, 15, 5])] += 1;
    }
    expect(counts.a).toBeGreaterThan(counts.b);
    expect(counts.b).toBeGreaterThan(counts.c);
    expect(counts.a / 12_000).toBeGreaterThan(0.72);
  });

  it('fork() is deterministic and independent of the parent stream position', () => {
    const parent = createRng(11);
    const f1 = parent.fork('scenario');
    const f2 = createRng(11).fork('scenario');
    expect(f1.next()).toBe(f2.next());
  });
});
