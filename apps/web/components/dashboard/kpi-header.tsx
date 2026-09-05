'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { StatTile } from '@/components/ui/stat-tile';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { formatMinorAsRupees, formatPct } from '@/lib/format';
import { useEvaluation } from '@/lib/queries';

/**
 * Phase 11 §4 — the top KPI header compares Recovery Desk to naive retries, so
 * it is sourced from the evaluation engine (`@recovery-desk/experiment`), not
 * from live payment counts: the live system never runs the naive strategy.
 */
export function KpiHeader() {
  const { data, isPending, isError, refetch } = useEvaluation({
    seed: DEFAULT_EVALUATION_SEED,
    count: DEFAULT_EVALUATION_COUNT,
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Recovery performance
        </h2>
        <span className="text-[11px] text-text-muted">
          vs naive retry · {DEFAULT_EVALUATION_COUNT} seeded failures · seed {DEFAULT_EVALUATION_SEED}
        </span>
      </div>
      {isError ? (
        <div className="px-4">
          <ErrorState message="Unable to load evaluation results." onRetry={() => refetch()} />
        </div>
      ) : isPending || !data ? (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface-1 px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
          <div className="bg-surface-1">
            <StatTile
              label="Recovery rate"
              value={formatPct(data.headline.recoveryDesk.recoveryRatePct)}
              delta={`↑ vs naive +${formatPct(data.headline.comparison.recoveryRateDeltaPts)}`}
            />
          </div>
          <div className="bg-surface-1">
            <StatTile
              label="Recovered"
              value={formatMinorAsRupees(data.headline.recoveryDesk.amountRecoveredMinor)}
              delta={`+${formatPct(data.headline.comparison.recoveredValueDeltaPct)} value`}
            />
          </div>
          <div className="bg-surface-1">
            <StatTile
              label="Attempts prevented"
              value={Math.max(
                0,
                data.headline.naive.attemptsConsumed - data.headline.recoveryDesk.attemptsConsumed,
              ).toLocaleString('en-IN')}
              delta={`${formatPct(data.headline.comparison.attemptsDeltaPct)} attempts`}
            />
          </div>
          <div className="bg-surface-1">
            <StatTile
              label="Cost / recovery"
              value={
                data.headline.recoveryDesk.costPerRecoveryMinor == null
                  ? '—'
                  : formatMinorAsRupees(data.headline.recoveryDesk.costPerRecoveryMinor)
              }
              delta={
                data.headline.comparison.costPerRecoveryDeltaPct == null
                  ? undefined
                  : `${formatPct(data.headline.comparison.costPerRecoveryDeltaPct)} vs naive`
              }
              deltaGood={
                data.headline.comparison.costPerRecoveryDeltaPct == null
                  ? undefined
                  : data.headline.comparison.costPerRecoveryDeltaPct < 0
              }
            />
          </div>
          <div className="bg-surface-1">
            <StatTile
              label="Human review"
              value={data.headline.recoveryDesk.humanReviews.toLocaleString('en-IN')}
              hint="of eligible failures"
            />
          </div>
        </div>
      )}
    </Card>
  );
}
