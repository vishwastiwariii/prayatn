import type {
  ExperimentComparison,
  PaymentRunResult,
  StrategyMetrics,
  StrategyName,
} from './types';

/** Cost model (minor units). Tunable but fixed for reproducibility. */
export const COST_PER_ATTEMPT_MINOR = 250; // ₹2.50 gateway + processing per charge attempt
export const COST_PER_MESSAGE_MINOR = 20; // ₹0.20 per customer SMS

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function aggregate(strategy: StrategyName, runs: PaymentRunResult[]): StrategyMetrics {
  const eligible = runs.length;
  let recoveredCount = 0;
  let amountRecoveredMinor = 0;
  let amountAtRiskMinor = 0;
  let attemptsConsumed = 0;
  let messagesSent = 0;
  let hardStops = 0;
  let humanReviews = 0;
  let exhausted = 0;

  for (const r of runs) {
    amountAtRiskMinor += r.amountMinor;
    attemptsConsumed += r.attemptsMade;
    messagesSent += r.messagesSent;
    if (r.recovered) {
      recoveredCount += 1;
      amountRecoveredMinor += r.amountRecoveredMinor;
    }
    if (r.endedBy === 'HARD_STOP') hardStops += 1;
    if (r.endedBy === 'HUMAN_REVIEW') humanReviews += 1;
    if (r.endedBy === 'EXHAUSTED') exhausted += 1;
  }

  const costMinor =
    attemptsConsumed * COST_PER_ATTEMPT_MINOR + messagesSent * COST_PER_MESSAGE_MINOR;

  return {
    strategy,
    paymentsProcessed: eligible,
    eligibleFailures: eligible,
    recoveredCount,
    recoveryRatePct: eligible === 0 ? 0 : round2((recoveredCount / eligible) * 100),
    amountRecoveredMinor,
    amountAtRiskMinor,
    attemptsConsumed,
    messagesSent,
    hardStops,
    humanReviews,
    exhausted,
    costMinor,
    costPerRecoveryMinor: recoveredCount === 0 ? null : Math.round(costMinor / recoveredCount),
  };
}

export function compare(naive: StrategyMetrics, rd: StrategyMetrics): ExperimentComparison {
  const pct = (a: number, b: number): number => (b === 0 ? 0 : round2(((a - b) / b) * 100));

  return {
    recoveredValueDeltaPct: pct(rd.amountRecoveredMinor, naive.amountRecoveredMinor),
    recoveryRateDeltaPts: round2(rd.recoveryRatePct - naive.recoveryRatePct),
    attemptsDeltaPct: pct(rd.attemptsConsumed, naive.attemptsConsumed),
    messagesDelta: rd.messagesSent - naive.messagesSent,
    costPerRecoveryDeltaPct:
      naive.costPerRecoveryMinor == null || rd.costPerRecoveryMinor == null
        ? null
        : pct(rd.costPerRecoveryMinor, naive.costPerRecoveryMinor),
    hardStops: rd.hardStops,
    humanReviews: rd.humanReviews,
  };
}
