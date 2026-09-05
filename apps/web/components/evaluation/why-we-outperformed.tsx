'use client';

import { Sparkles } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { formatMinorAsRupees } from '@/lib/format';
import { useEvaluation } from '@/lib/queries';

/**
 * Phase 11 §12 — a deterministic template over real evaluation metrics.
 * No LLM: the explanation only restates numbers the backend already computed.
 */
export function WhyWeOutperformed() {
  const { data, isPending } = useEvaluation({ seed: DEFAULT_EVALUATION_SEED, count: DEFAULT_EVALUATION_COUNT });

  if (isPending || !data) {
    return (
      <Card>
        <CardHeader title="Why we did this" />
        <div className="p-4">
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }

  const { naive, recoveryDesk } = data.headline;
  const deltaAmount = recoveryDesk.amountRecoveredMinor - naive.amountRecoveredMinor;
  const deltaAttempts = naive.attemptsConsumed - recoveryDesk.attemptsConsumed;

  return (
    <Card>
      <CardHeader title="Why we did this" subtitle="Deterministic template over evaluation metrics — no LLM" />
      <div className="flex gap-3 p-4">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-sm text-text-secondary">
          <p>
            Recovery Desk avoided wasting attempts on {recoveryDesk.hardStops} structurally unrecoverable
            payment{recoveryDesk.hardStops === 1 ? '' : 's'} (expired cards, revoked mandates), waited through
            temporary issuer and gateway failures instead of retrying blind, and routed{' '}
            {recoveryDesk.humanReviews} unclassifiable failure{recoveryDesk.humanReviews === 1 ? '' : 's'} to human
            review rather than guessing.
          </p>
          <p className="mt-2 font-medium text-text-primary">
            Result: {deltaAmount >= 0 ? formatMinorAsRupees(deltaAmount) : `−${formatMinorAsRupees(-deltaAmount)}`}{' '}
            {deltaAmount >= 0 ? 'additional' : 'less'} amount recovered with{' '}
            {Math.abs(deltaAttempts).toLocaleString('en-IN')} {deltaAttempts >= 0 ? 'fewer' : 'more'} payment
            attempts, on the same {data.datasetSize} seeded failures.
          </p>
        </div>
      </div>
    </Card>
  );
}
