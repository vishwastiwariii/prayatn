import { describe, expect, it } from 'vitest';
import { rootCauseBreakdown } from './breakdown';
import { runExperimentDetailed } from './runner';

const VALID_CAUSES = new Set([
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
]);

describe('rootCauseBreakdown', () => {
  const { dataset, result, naiveRuns, recoveryDeskRuns } = runExperimentDetailed({
    seed: 20260904,
    count: 500,
  });
  const rows = rootCauseBreakdown(dataset, naiveRuns, recoveryDeskRuns);

  it('every row is a real RootCause and is sorted by volume', () => {
    for (const r of rows) expect(VALID_CAUSES.has(r.cause)).toBe(true);
    const volumes = rows.map((r) => r.initialFailures);
    expect(volumes).toEqual([...volumes].sort((a, b) => b - a));
  });

  it('row totals reconcile exactly with the aggregate metrics', () => {
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    expect(sum((r) => r.initialFailures)).toBe(500);
    expect(sum((r) => r.naiveRecoveries)).toBe(result.naive.recoveredCount);
    expect(sum((r) => r.recoveryDeskRecoveries)).toBe(result.recoveryDesk.recoveredCount);
    expect(sum((r) => r.naiveAttempts)).toBe(result.naive.attemptsConsumed);
    expect(sum((r) => r.recoveryDeskAttempts)).toBe(result.recoveryDesk.attemptsConsumed);
    expect(sum((r) => r.naiveAmountRecoveredMinor)).toBe(result.naive.amountRecoveredMinor);
    expect(sum((r) => r.recoveryDeskAmountRecoveredMinor)).toBe(
      result.recoveryDesk.amountRecoveredMinor,
    );
  });

  it('is deterministic', () => {
    const again = runExperimentDetailed({ seed: 20260904, count: 500 });
    expect(
      JSON.stringify(rootCauseBreakdown(again.dataset, again.naiveRuns, again.recoveryDeskRuns)),
    ).toBe(JSON.stringify(rows));
  });

  it('for permanent causes, neither strategy recovers, and RD spends fewer attempts', () => {
    for (const cause of ['MANDATE_INVALID', 'PAYMENT_METHOD_INVALID', 'UNKNOWN']) {
      const r = rows.find((x) => x.cause === cause);
      if (!r) continue;
      expect(r.naiveRecoveries).toBe(0);
      expect(r.recoveryDeskRecoveries).toBe(0);
      expect(r.recoveryDeskAttempts).toBeLessThan(r.naiveAttempts);
      // RD spends exactly one attempt (the original) then hard-stops / routes to human
      expect(r.recoveryDeskAttempts).toBe(r.initialFailures);
    }
  });
});
