'use client';

import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { formatMinorAsRupees, formatPct } from '@/lib/format';
import { useEvaluation } from '@/lib/queries';

/**
 * Phase 13 §19-21 — the closing numbers. Every figure comes from the Phase 9
 * evaluation API (the full 500-payment experiment), never from the twelve
 * payments on screen and never hardcoded.
 */
export function DemoResults() {
  const { data, isPending, isError, refetch } = useEvaluation({
    seed: DEFAULT_EVALUATION_SEED,
    count: DEFAULT_EVALUATION_COUNT,
  });

  if (isError) {
    return (
      <Card>
        <CardHeader title="Results" />
        <div className="p-4">
          <ErrorState message="Unable to load the evaluation." onRetry={() => refetch()} />
        </div>
      </Card>
    );
  }

  if (isPending || !data) {
    return (
      <Card>
        <CardHeader title="Results" />
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      </Card>
    );
  }

  const { naive, recoveryDesk, comparison } = data.headline;
  const attemptsPrevented = Math.max(0, naive.attemptsConsumed - recoveryDesk.attemptsConsumed);
  const extraRecovered = recoveryDesk.amountRecoveredMinor - naive.amountRecoveredMinor;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Recovery Desk results"
          subtitle={`${data.datasetSize} seeded failures · seed ${data.primarySeed} · same hidden state for both strategies`}
        />
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Tile label="Recovery rate" value={formatPct(recoveryDesk.recoveryRatePct)} delta={`+${formatPct(comparison.recoveryRateDeltaPts)} vs naive`} />
          <Tile label="Recovered" value={formatMinorAsRupees(recoveryDesk.amountRecoveredMinor)} delta={`+${formatPct(comparison.recoveredValueDeltaPct)}`} />
          <Tile label="Attempts prevented" value={attemptsPrevented.toLocaleString('en-IN')} delta={`${formatPct(comparison.attemptsDeltaPct)} attempts`} />
          <Tile
            label="Cost / recovery"
            value={recoveryDesk.costPerRecoveryMinor == null ? '—' : formatMinorAsRupees(recoveryDesk.costPerRecoveryMinor)}
            delta={comparison.costPerRecoveryDeltaPct == null ? undefined : `${formatPct(comparison.costPerRecoveryDeltaPct)} vs naive`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Naive retry vs Recovery Desk" subtitle="Same dataset. Only the strategy changed." />
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="pb-1.5 font-medium">Metric</th>
                <th className="pb-1.5 font-medium">Naive</th>
                <th className="pb-1.5 font-medium">Recovery Desk</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <Row label="Recovery rate" a={formatPct(naive.recoveryRatePct)} b={formatPct(recoveryDesk.recoveryRatePct)} />
              <Row label="Recovered" a={formatMinorAsRupees(naive.amountRecoveredMinor)} b={formatMinorAsRupees(recoveryDesk.amountRecoveredMinor)} />
              <Row label="Attempts" a={naive.attemptsConsumed.toLocaleString('en-IN')} b={recoveryDesk.attemptsConsumed.toLocaleString('en-IN')} />
              <Row
                label="Cost / recovery"
                a={naive.costPerRecoveryMinor == null ? '—' : formatMinorAsRupees(naive.costPerRecoveryMinor)}
                b={recoveryDesk.costPerRecoveryMinor == null ? '—' : formatMinorAsRupees(recoveryDesk.costPerRecoveryMinor)}
              />
              <Row label="Hard stops" a={String(naive.hardStops)} b={String(recoveryDesk.hardStops)} />
              <Row label="Human reviews" a={String(naive.humanReviews)} b={String(recoveryDesk.humanReviews)} />
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="p-6 text-center">
          <p className="text-xl font-semibold leading-snug text-text-primary sm:text-2xl">
            A payment failure is a diagnosis problem,
            <br />
            not a retry button.
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            On the same {data.datasetSize} failures, Recovery Desk recovered{' '}
            <span className="font-semibold text-text-primary">
              {extraRecovered >= 0 ? formatMinorAsRupees(extraRecovered) : `−${formatMinorAsRupees(-extraRecovered)}`}
            </span>{' '}
            more using{' '}
            <span className="font-semibold text-text-primary">
              {attemptsPrevented.toLocaleString('en-IN')} fewer
            </span>{' '}
            payment attempts.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="bg-surface-1 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-2xl font-semibold text-text-primary">{value}</p>
      {delta && <p className="text-xs font-medium text-status-good">{delta}</p>}
    </div>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 text-text-secondary">{label}</td>
      <td className="py-1.5 text-text-secondary">{a}</td>
      <td className="py-1.5 font-semibold text-text-primary">{b}</td>
    </tr>
  );
}
