import type { FailureDescriptor, SimPaymentMethod } from '@recovery-desk/simulator';

export type StrategyName = 'NAIVE' | 'RECOVERY_DESK';

export type RunEnd =
  'RECOVERED' | 'EXHAUSTED' | 'HARD_STOP' | 'HUMAN_REVIEW' | 'MESSAGE_LIMIT' | 'HORIZON';

/**
 * The ONLY surface a strategy is given for one payment. There is no accessor
 * for the scenario, the resolution time, the "customer cooperates" flag, or any
 * other hidden field — the simulator keeps those private.
 */
export interface StrategyEnv {
  readonly payment: {
    id: string;
    method: SimPaymentMethod;
    amountMinor: number;
    currency: 'INR';
    salaryDay: number;
  };
  /** The original charge already failed; this describes how. */
  readonly initialFailure: FailureDescriptor;

  now(): Date;
  minutesElapsed(): number;
  /** Attempts made so far, including the original failed charge (starts at 1). */
  attemptsMade(): number;
  messagesSent(): number;
  railSwitched(): boolean;
  /** The most recent failure descriptor seen. */
  lastFailure(): FailureDescriptor;

  /** Wait `delayMinutes`, then make one charge attempt. */
  retry(delayMinutes: number): { status: 'SUCCESS' | 'FAILURE' };
  /** Send one customer message (advances the clock a little). */
  message(): void;
  /** Record that an alternate rail was offered (abandonment scenarios). */
  switchRail(): void;
  /** End this payment's run with an explicit reason. */
  stop(reason: RunEnd): void;
}

export interface PaymentRunResult {
  paymentId: string;
  method: SimPaymentMethod;
  amountMinor: number;
  recovered: boolean;
  amountRecoveredMinor: number;
  attemptsMade: number;
  messagesSent: number;
  railSwitched: boolean;
  endedBy: RunEnd;
  minutesElapsed: number;
}

export interface StrategyMetrics {
  strategy: StrategyName;
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

export interface ExperimentResult {
  seed: number;
  count: number;
  methodBreakdown: Record<string, number>;
  scenarioBreakdown: Record<string, number>;
  naive: StrategyMetrics;
  recoveryDesk: StrategyMetrics;
  comparison: ExperimentComparison;
}
