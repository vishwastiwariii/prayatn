import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KpiHeader } from '@/components/dashboard/kpi-header';
import type { EvaluationSummary } from '@/lib/api/evaluation';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

function metrics(overrides: Partial<EvaluationSummary['headline']['naive']>) {
  return {
    strategy: 'NAIVE' as const,
    paymentsProcessed: 500,
    eligibleFailures: 500,
    recoveredCount: 235,
    recoveryRatePct: 47,
    amountRecoveredMinor: 31_000_00,
    amountAtRiskMinor: 66_000_00,
    attemptsConsumed: 1500,
    messagesSent: 0,
    hardStops: 0,
    humanReviews: 0,
    exhausted: 0,
    costMinor: 1500 * 250,
    costPerRecoveryMinor: 1420,
    ...overrides,
  };
}

const summary: EvaluationSummary = {
  evaluationId: 'eval_test1',
  status: 'COMPLETED',
  datasetSize: 500,
  seeds: [20260904],
  primarySeed: 20260904,
  costModel: { perAttemptMinor: 250, perMessageMinor: 20 },
  headline: {
    naive: metrics({}),
    recoveryDesk: metrics({
      strategy: 'RECOVERY_DESK',
      recoveredCount: 342,
      recoveryRatePct: 68.4,
      amountRecoveredMinor: 48_200_00,
      attemptsConsumed: 684,
      hardStops: 74,
      humanReviews: 23,
      costPerRecoveryMinor: 740,
    }),
    comparison: {
      recoveredValueDeltaPct: 55.5,
      recoveryRateDeltaPts: 21.4,
      attemptsDeltaPct: -54.4,
      messagesDelta: 162,
      costPerRecoveryDeltaPct: -47.9,
      hardStops: 74,
      humanReviews: 23,
    },
  },
  rootCauseBreakdown: [],
  aggregate: {
    seedCount: 1,
    naiveRecoveryRatePct: { mean: 47, min: 47, max: 47 },
    recoveryDeskRecoveryRatePct: { mean: 68.4, min: 68.4, max: 68.4 },
    recoveryRateDeltaPts: { mean: 21.4, min: 21.4, max: 21.4 },
    recoveredValueDeltaPct: { mean: 55.5, min: 55.5, max: 55.5 },
    attemptsDeltaPct: { mean: -54.4, min: -54.4, max: -54.4 },
    recoveryDeskWinsEverySeed: true,
  },
  renderedSummary: '',
};

describe('KpiHeader', () => {
  beforeEach(() => {
    mockFetchByPath({
      '/api/evaluations': () => ({ status: 201, body: { evaluationId: 'eval_test1', status: 'COMPLETED' } }),
      '/api/evaluations/eval_test1': () => ({ status: 200, body: summary }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows loading skeletons before data arrives', () => {
    renderWithQueryClient(<KpiHeader />);
    expect(screen.getByText('Recovery performance')).toBeInTheDocument();
    expect(screen.queryByText('68.4%')).not.toBeInTheDocument();
  });

  it('renders KPI values sourced from the evaluation API, never hardcoded', async () => {
    renderWithQueryClient(<KpiHeader />);

    await waitFor(() => expect(screen.getByText('68.4%')).toBeInTheDocument());
    expect(screen.getByText(/\+21\.4%/)).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText(/816/)).toBeInTheDocument();
  });
});
