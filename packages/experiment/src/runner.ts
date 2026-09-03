import { createHiddenStateSimulator, generateDataset } from '@recovery-desk/simulator';
import { type Strategy, runPayment } from './env';
import { aggregate, compare } from './metrics';
import { naiveStrategy, recoveryDeskStrategy } from './strategies';
import type { ExperimentResult, PaymentRunResult } from './types';

export interface RunExperimentOptions {
  seed?: number;
  count?: number;
}

/**
 * The experiment runner — Phase 12/13.
 *
 *   generate the frozen batch (seeded)
 *        │
 *   ┌────┴─────┐   both strategies see the SAME payments and the SAME hidden
 *   Naive    Recovery Desk       simulator; neither sees the hidden truth
 *   └────┬─────┘
 *   aggregate + compare
 *
 * Pure and deterministic: same {seed, count} => deep-equal `ExperimentResult`.
 */
export function runExperiment(opts: RunExperimentOptions = {}): ExperimentResult {
  const seed = opts.seed ?? 20260828;
  const count = opts.count ?? 500;

  const dataset = generateDataset(seed, count);
  const simulator = createHiddenStateSimulator(dataset);

  const run = (strategy: Strategy): PaymentRunResult[] =>
    dataset.payments.map((p) => runPayment(simulator, p, strategy));

  const naiveRuns = run(naiveStrategy);
  const rdRuns = run(recoveryDeskStrategy);

  const naive = aggregate('NAIVE', naiveRuns);
  const recoveryDesk = aggregate('RECOVERY_DESK', rdRuns);

  return {
    seed,
    count,
    methodBreakdown: dataset.methodBreakdown,
    scenarioBreakdown: dataset.scenarioBreakdown,
    naive,
    recoveryDesk,
    comparison: compare(naive, recoveryDesk),
  };
}

/** Per-payment runs for both strategies — handy for drill-downs and tests. */
export function runExperimentDetailed(opts: RunExperimentOptions = {}): {
  result: ExperimentResult;
  dataset: ReturnType<typeof generateDataset>;
  naiveRuns: PaymentRunResult[];
  recoveryDeskRuns: PaymentRunResult[];
} {
  const seed = opts.seed ?? 20260828;
  const count = opts.count ?? 500;
  const dataset = generateDataset(seed, count);
  const simulator = createHiddenStateSimulator(dataset);
  const naiveRuns = dataset.payments.map((p) => runPayment(simulator, p, naiveStrategy));
  const recoveryDeskRuns = dataset.payments.map((p) =>
    runPayment(simulator, p, recoveryDeskStrategy),
  );
  const naive = aggregate('NAIVE', naiveRuns);
  const recoveryDesk = aggregate('RECOVERY_DESK', recoveryDeskRuns);
  return {
    result: {
      seed,
      count,
      methodBreakdown: dataset.methodBreakdown,
      scenarioBreakdown: dataset.scenarioBreakdown,
      naive,
      recoveryDesk,
      comparison: compare(naive, recoveryDesk),
    },
    dataset,
    naiveRuns,
    recoveryDeskRuns,
  };
}
