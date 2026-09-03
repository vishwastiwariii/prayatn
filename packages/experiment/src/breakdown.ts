import { classify } from '@recovery-desk/classifier';
import { type SimulatedDataset, createHiddenStateSimulator } from '@recovery-desk/simulator';
import type { PaymentRunResult } from './types';

/**
 * Per-root-cause comparison. The "root cause" is what the deterministic
 * classifier assigns to each payment's INITIAL failure descriptor (the same
 * thing Recovery Desk sees) — so both strategies' results are bucketed the same
 * way, even though the naive strategy never classifies anything itself.
 */
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

function emptyRow(cause: string): RootCauseRow {
  return {
    cause,
    initialFailures: 0,
    naiveRecoveries: 0,
    recoveryDeskRecoveries: 0,
    naiveAttempts: 0,
    recoveryDeskAttempts: 0,
    naiveAmountRecoveredMinor: 0,
    recoveryDeskAmountRecoveredMinor: 0,
  };
}

export function rootCauseBreakdown(
  dataset: SimulatedDataset,
  naiveRuns: PaymentRunResult[],
  recoveryDeskRuns: PaymentRunResult[],
): RootCauseRow[] {
  const sim = createHiddenStateSimulator(dataset);
  const rows = new Map<string, RootCauseRow>();

  dataset.payments.forEach((payment, i) => {
    const f = sim.initialFailure(payment.id);
    const { cause } = classify({
      errorCode: f.code,
      errorReason: f.reason,
      errorSource: f.source,
      errorStep: f.step,
      errorDescription: f.description,
      method: payment.method,
    });

    const row = rows.get(cause) ?? emptyRow(cause);
    const n = naiveRuns[i];
    const d = recoveryDeskRuns[i];
    if (!n || !d) return;

    row.initialFailures += 1;
    row.naiveAttempts += n.attemptsMade;
    row.recoveryDeskAttempts += d.attemptsMade;
    if (n.recovered) {
      row.naiveRecoveries += 1;
      row.naiveAmountRecoveredMinor += n.amountRecoveredMinor;
    }
    if (d.recovered) {
      row.recoveryDeskRecoveries += 1;
      row.recoveryDeskAmountRecoveredMinor += d.amountRecoveredMinor;
    }
    rows.set(cause, row);
  });

  return [...rows.values()].sort((a, b) => b.initialFailures - a.initialFailures);
}
