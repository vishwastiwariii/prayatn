import { describe, expect, it } from 'vitest';
import { DEFAULT_EVALUATION_SEED, evaluationIdFor, runEvaluation } from './evaluation';
import { runExperimentDetailed } from './runner';

describe('runEvaluation — determinism & identity', () => {
  it('same params -> byte-identical summary and id', () => {
    const a = runEvaluation({ seeds: [1, 2], count: 120 });
    const b = runEvaluation({ seeds: [1, 2], count: 120 });
    expect(a.evaluationId).toBe(b.evaluationId);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the id is a stable function of (ordered seeds, count)', () => {
    expect(evaluationIdFor([20260904], 500)).toMatch(/^eval_[0-9a-f]{8}$/);
    expect(evaluationIdFor([1, 2], 120)).not.toBe(evaluationIdFor([2, 1], 120));
    expect(evaluationIdFor([1, 2], 120)).not.toBe(evaluationIdFor([1, 2], 121));
    expect(runEvaluation({ seeds: [7], count: 100 }).evaluationId).toBe(evaluationIdFor([7], 100));
  });

  it('defaults to a single run on the Phase 9 seed', () => {
    const s = runEvaluation();
    expect(s.seeds).toEqual([DEFAULT_EVALUATION_SEED]);
    expect(s.datasetSize).toBe(500);
    expect(s.status).toBe('COMPLETED');
  });
});

describe('runEvaluation — headline numbers come from the simulator, not hardcoded', () => {
  const s = runEvaluation({ seed: 20260904, count: 500 });
  const detailed = runExperimentDetailed({ seed: 20260904, count: 500 });

  it('headline == the primary seed experiment run', () => {
    expect(s.headline.naive).toEqual(detailed.result.naive);
    expect(s.headline.recoveryDesk).toEqual(detailed.result.recoveryDesk);
    expect(s.headline.recoveryDesk.recoveredCount).toBe(
      detailed.recoveryDeskRuns.filter((r) => r.recovered).length,
    );
    expect(s.headline.naive.recoveredCount).toBe(
      detailed.naiveRuns.filter((r) => r.recovered).length,
    );
  });

  it('answers the core question: more money, higher rate, fewer attempts', () => {
    expect(s.headline.recoveryDesk.recoveredCount).toBeGreaterThan(s.headline.naive.recoveredCount);
    expect(s.headline.recoveryDesk.amountRecoveredMinor).toBeGreaterThan(
      s.headline.naive.amountRecoveredMinor,
    );
    expect(s.headline.recoveryDesk.recoveryRatePct).toBeGreaterThan(
      s.headline.naive.recoveryRatePct,
    );
    expect(s.headline.recoveryDesk.attemptsConsumed).toBeLessThan(
      s.headline.naive.attemptsConsumed,
    );
    expect(s.headline.naive.messagesSent).toBe(0);
    expect(s.headline.naive.hardStops).toBe(0);
    expect(s.headline.naive.humanReviews).toBe(0);
    expect(s.headline.recoveryDesk.hardStops).toBeGreaterThan(0);
    expect(s.headline.recoveryDesk.humanReviews).toBeGreaterThan(0);
  });

  it('includes a per-root-cause breakdown that reconciles with the headline', () => {
    const sum = (f: (r: (typeof s.rootCauseBreakdown)[number]) => number) =>
      s.rootCauseBreakdown.reduce((a, r) => a + f(r), 0);
    expect(sum((r) => r.initialFailures)).toBe(500);
    expect(sum((r) => r.recoveryDeskRecoveries)).toBe(s.headline.recoveryDesk.recoveredCount);
    expect(sum((r) => r.naiveAttempts)).toBe(s.headline.naive.attemptsConsumed);
  });
});

describe('runEvaluation — multi-seed (not a lucky seed)', () => {
  const seeds = [20260904, 20260905, 42, 7, 999];
  const s = runEvaluation({ seeds, count: 500 });

  it('runs every seed and aggregates the spread', () => {
    expect(s.perSeed.map((p) => p.seed)).toEqual(seeds);
    expect(s.aggregate.seedCount).toBe(5);
    for (const key of [
      'naiveRecoveryRatePct',
      'recoveryDeskRecoveryRatePct',
      'recoveryRateDeltaPts',
      'recoveredValueDeltaPct',
      'attemptsDeltaPct',
    ] as const) {
      const sp = s.aggregate[key];
      expect(sp.min).toBeLessThanOrEqual(sp.mean);
      expect(sp.mean).toBeLessThanOrEqual(sp.max);
    }
  });

  it('Recovery Desk wins on EVERY seed', () => {
    expect(s.aggregate.recoveryDeskWinsEverySeed).toBe(true);
    for (const p of s.perSeed) {
      expect(p.recoveryDesk.recoveredCount).toBeGreaterThan(p.naive.recoveredCount);
      expect(p.comparison.recoveryRateDeltaPts).toBeGreaterThan(0);
      expect(p.comparison.attemptsDeltaPct).toBeLessThan(0);
    }
  });

  it('the aggregate rate-delta mean is a real improvement, not marginal', () => {
    expect(s.aggregate.recoveryRateDeltaPts.mean).toBeGreaterThan(10);
    expect(s.aggregate.recoveredValueDeltaPct.mean).toBeGreaterThan(50);
  });
});

describe('runEvaluation — rendered summary', () => {
  it('contains the required sections and the real numbers', () => {
    const s = runEvaluation({ seeds: [20260904, 20260905], count: 200 });
    const txt = s.renderedSummary;
    expect(txt).toContain('RECOVERY DESK — EXPERIMENT RESULTS');
    expect(txt).toContain('200 failed payments');
    expect(txt).toContain('Recovery Rate');
    expect(txt).toContain('Hard Stops');
    expect(txt).toContain('Human Review');
    expect(txt).toContain('BY ROOT CAUSE');
    expect(txt).toContain('ACROSS 2 SEEDS');
    expect(txt).toContain(`${s.headline.recoveryDesk.recoveredCount}`);
    expect(txt).toContain(`${s.headline.recoveryDesk.recoveryRatePct}%`);
  });

  it('validates its inputs', () => {
    expect(() => runEvaluation({ count: 3 })).toThrow(/count/);
    expect(() => runEvaluation({ seeds: Array.from({ length: 40 }, (_, i) => i) })).toThrow(
      /seeds/,
    );
  });
});
