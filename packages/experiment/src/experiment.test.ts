import {
  type SimulatedPayment,
  createHiddenStateSimulator,
  generateDataset,
} from '@recovery-desk/simulator';
import { describe, expect, it } from 'vitest';
import { runPayment } from './env';
import { aggregate, compare } from './metrics';
import { runExperiment } from './runner';
import type { PaymentRunResult, StrategyEnv } from './types';

describe('runExperiment — determinism', () => {
  it('same {seed, count} -> byte-identical result', () => {
    const a = runExperiment({ seed: 12345, count: 150 });
    const b = runExperiment({ seed: 12345, count: 150 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a different seed -> different result', () => {
    const a = runExperiment({ seed: 1, count: 150 });
    const b = runExperiment({ seed: 2, count: 150 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('the default run (seed 20260828, 500) is stable across calls', () => {
    expect(JSON.stringify(runExperiment())).toBe(JSON.stringify(runExperiment()));
  });
});

describe('runExperiment — same batch, same conditions, both strategies', () => {
  const r = runExperiment({ seed: 20260828, count: 500 });

  it('both strategies process the identical 500-payment batch', () => {
    expect(r.count).toBe(500);
    expect(r.naive.eligibleFailures).toBe(500);
    expect(r.recoveryDesk.eligibleFailures).toBe(500);
    expect(r.naive.amountAtRiskMinor).toBe(r.recoveryDesk.amountAtRiskMinor);
  });

  it('tracks every required metric', () => {
    for (const m of [r.naive, r.recoveryDesk]) {
      expect(m.recoveredCount).toBeGreaterThanOrEqual(0);
      expect(m.recoveryRatePct).toBeGreaterThanOrEqual(0);
      expect(m.amountRecoveredMinor).toBeGreaterThanOrEqual(0);
      expect(m.attemptsConsumed).toBeGreaterThan(0);
      expect(m.messagesSent).toBeGreaterThanOrEqual(0);
      expect(m.costMinor).toBeGreaterThan(0);
    }
    expect(r.recoveryDesk.costPerRecoveryMinor).toBeGreaterThan(0);
  });

  it('Recovery Desk recovers more value at a higher rate for less cost per recovery', () => {
    expect(r.recoveryDesk.recoveredCount).toBeGreaterThan(r.naive.recoveredCount);
    expect(r.comparison.recoveredValueDeltaPct).toBeGreaterThan(0);
    expect(r.comparison.recoveryRateDeltaPts).toBeGreaterThan(0);
    expect(r.comparison.attemptsDeltaPct).toBeLessThan(0); // fewer attempts
    expect(r.comparison.costPerRecoveryDeltaPct).toBeLessThan(0); // cheaper per recovery
  });

  it('Recovery Desk hard-stops invalid instruments and routes unknowns to humans; naive does neither', () => {
    expect(r.recoveryDesk.hardStops).toBeGreaterThan(0);
    expect(r.recoveryDesk.humanReviews).toBeGreaterThan(0);
    expect(r.naive.hardStops).toBe(0);
    expect(r.naive.humanReviews).toBe(0);
    expect(r.naive.messagesSent).toBe(0);
  });
});

describe('the strategy never sees hidden state', () => {
  it('the StrategyEnv handed to a strategy exposes only public members', () => {
    const dataset = generateDataset(7, 5);
    const sim = createHiddenStateSimulator(dataset);
    const payment = dataset.payments[0] as SimulatedPayment;

    let captured: StrategyEnv | null = null;
    runPayment(sim, payment, (env) => {
      captured = env;
      env.stop('EXHAUSTED');
    });

    const env = captured as unknown as StrategyEnv;
    const keys = Object.keys(env).sort();
    expect(keys).toEqual(
      [
        'attemptsMade',
        'initialFailure',
        'lastFailure',
        'message',
        'messagesSent',
        'minutesElapsed',
        'now',
        'payment',
        'railSwitched',
        'retry',
        'stop',
        'switchRail',
      ].sort(),
    );
    // no reference to the simulator, dataset or any truth field
    for (const k of keys)
      expect(k).not.toMatch(/truth|simulat|dataset|scenario|resolve|cooperat|permanent/i);
    const serialised = JSON.stringify(env, (_k, v) => (typeof v === 'function' ? null : v));
    for (const banned of ['resolvesAtMs', 'customerCooperates', 'permanent', 'needsNudge', 'kind'])
      expect(serialised).not.toContain(banned);
  });
});

describe('metrics helpers', () => {
  const run = (over: Partial<PaymentRunResult>): PaymentRunResult => ({
    paymentId: 'p',
    method: 'CARD',
    amountMinor: 100_000,
    recovered: false,
    amountRecoveredMinor: 0,
    attemptsMade: 4,
    messagesSent: 0,
    railSwitched: false,
    endedBy: 'EXHAUSTED',
    minutesElapsed: 0,
    ...over,
  });

  it('aggregate computes rate, value, cost and cost-per-recovery', () => {
    const m = aggregate('NAIVE', [
      run({ recovered: true, amountRecoveredMinor: 100_000, attemptsMade: 2 }),
      run({ attemptsMade: 4 }),
      run({ recovered: true, amountRecoveredMinor: 100_000, attemptsMade: 3, messagesSent: 1 }),
      run({ attemptsMade: 4, endedBy: 'HARD_STOP' }),
    ]);
    expect(m.recoveredCount).toBe(2);
    expect(m.recoveryRatePct).toBe(50);
    expect(m.amountRecoveredMinor).toBe(200_000);
    expect(m.attemptsConsumed).toBe(13);
    expect(m.messagesSent).toBe(1);
    expect(m.hardStops).toBe(1);
    // 13 * 250 + 1 * 20 = 3270 ; /2 recoveries = 1635
    expect(m.costMinor).toBe(3270);
    expect(m.costPerRecoveryMinor).toBe(1635);
  });

  it('compare produces signed deltas', () => {
    const naive = aggregate('NAIVE', [
      run({ recovered: true, amountRecoveredMinor: 100_000 }),
      run({}),
    ]);
    const rd = aggregate('RECOVERY_DESK', [
      run({ recovered: true, amountRecoveredMinor: 100_000, attemptsMade: 2 }),
      run({ recovered: true, amountRecoveredMinor: 100_000, attemptsMade: 2 }),
    ]);
    const c = compare(naive, rd);
    expect(c.recoveredValueDeltaPct).toBe(100);
    expect(c.recoveryRateDeltaPts).toBe(50);
    expect(c.attemptsDeltaPct).toBeLessThan(0);
  });
});
