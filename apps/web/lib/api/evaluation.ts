import { apiFetch } from './client';

export interface StrategyMetrics {
  strategy: 'NAIVE' | 'RECOVERY_DESK';
  paymentsProcessed: number;
  eligibleFailures: number;
  recoveredCount: number;
  recoveryRatePct: number;
  amountRecoveredMinor: number;
  amountAtRiskMinor: number;
  attemptsConsumed: number;
  messagesSent: number;
  hardStops: number;
  humanReviews: number;
  exhausted: number;
  costMinor: number;
  costPerRecoveryMinor: number | null;
}

export interface ExperimentComparison {
  recoveredValueDeltaPct: number;
  recoveryRateDeltaPts: number;
  attemptsDeltaPct: number;
  messagesDelta: number;
  costPerRecoveryDeltaPct: number | null;
  hardStops: number;
  humanReviews: number;
}

export interface RootCauseRow {
  cause: string;
  initialFailures: number;
  naiveRecoveries: number;
  recoveryDeskRecoveries: number;
  naiveAttempts: number;
  recoveryDeskAttempts: number;
  naiveAmountRecoveredMinor: number;
  recoveryDeskAmountRecoveredMinor: number;
}

export interface Spread {
  mean: number;
  min: number;
  max: number;
}

export interface EvaluationSummary {
  evaluationId: string;
  status: 'COMPLETED';
  datasetSize: number;
  seeds: number[];
  primarySeed: number;
  costModel: { perAttemptMinor: number; perMessageMinor: number };
  headline: {
    naive: StrategyMetrics;
    recoveryDesk: StrategyMetrics;
    comparison: ExperimentComparison;
  };
  rootCauseBreakdown: RootCauseRow[];
  aggregate: {
    seedCount: number;
    naiveRecoveryRatePct: Spread;
    recoveryDeskRecoveryRatePct: Spread;
    recoveryRateDeltaPts: Spread;
    recoveredValueDeltaPct: Spread;
    attemptsDeltaPct: Spread;
    recoveryDeskWinsEverySeed: boolean;
  };
  renderedSummary: string;
}

export interface StartEvaluationOptions {
  seed?: number;
  seeds?: number[];
  count?: number;
}

export async function startEvaluation(
  options: StartEvaluationOptions = {},
): Promise<{ evaluationId: string; status: 'COMPLETED' }> {
  return apiFetch('/api/evaluations', { method: 'POST', body: options });
}

export function getEvaluation(evaluationId: string, signal?: AbortSignal): Promise<EvaluationSummary> {
  return apiFetch<EvaluationSummary>(`/api/evaluations/${encodeURIComponent(evaluationId)}`, {
    signal,
  });
}

export const DEFAULT_EVALUATION_SEED = 20260904;
export const DEFAULT_EVALUATION_COUNT = 500;
