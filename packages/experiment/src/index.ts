/**
 * `@recovery-desk/experiment` — the baseline-vs-Recovery-Desk experiment harness.
 *
 * Runs the naive 3-immediate-retry baseline and the real Phase 6/7 Recovery
 * Desk logic against the SAME seeded 500-payment batch and the SAME hidden-state
 * simulator, then compares ₹ recovered, recovery rate, attempts, messages and
 * cost per recovery.
 *
 * Neither strategy can see the simulator's hidden state — the thing that
 * actually decides whether a payment succeeds.
 */
export { runExperiment, runExperimentDetailed } from './runner';
export type { RunExperimentOptions } from './runner';
export {
  runEvaluation,
  renderSummary,
  evaluationIdFor,
  DEFAULT_EVALUATION_SEED,
} from './evaluation';
export type {
  RunEvaluationOptions,
  EvaluationSummary,
  EvaluationAggregate,
  SeedResult,
  Spread,
} from './evaluation';
export { rootCauseBreakdown } from './breakdown';
export type { RootCauseRow } from './breakdown';
export { naiveStrategy, recoveryDeskStrategy } from './strategies';
export { runPayment, HORIZON_MINUTES } from './env';
export type { Strategy } from './env';
export { aggregate, compare, COST_PER_ATTEMPT_MINOR, COST_PER_MESSAGE_MINOR } from './metrics';
export type {
  StrategyEnv,
  StrategyName,
  RunEnd,
  PaymentRunResult,
  StrategyMetrics,
  ExperimentComparison,
  ExperimentResult,
} from './types';
