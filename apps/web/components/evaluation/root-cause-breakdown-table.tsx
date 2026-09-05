'use client';

import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { formatMinorAsRupees } from '@/lib/format';
import { useEvaluation } from '@/lib/queries';

export function RootCauseBreakdownTable() {
  const { data, isPending } = useEvaluation({ seed: DEFAULT_EVALUATION_SEED, count: DEFAULT_EVALUATION_COUNT });

  return (
    <Card>
      <CardHeader title="By root cause" subtitle="Naive vs Recovery Desk, bucketed by the same classifier both strategies see" />
      <div className="overflow-x-auto p-4">
        {isPending || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-muted">
                <th className="py-1.5 pr-3 font-medium">Root cause</th>
                <th className="py-1.5 pr-3 font-medium">Failures</th>
                <th className="py-1.5 pr-3 font-medium">Naive rec.</th>
                <th className="py-1.5 pr-3 font-medium">RD rec.</th>
                <th className="py-1.5 pr-3 font-medium">Naive att.</th>
                <th className="py-1.5 pr-3 font-medium">RD att.</th>
                <th className="py-1.5 pr-3 font-medium">₹ Naive</th>
                <th className="py-1.5 font-medium">₹ Recovery Desk</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.rootCauseBreakdown.map((row) => (
                <tr key={row.cause} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-text-primary">{row.cause.replaceAll('_', ' ')}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{row.initialFailures}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{row.naiveRecoveries}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{row.recoveryDeskRecoveries}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{row.naiveAttempts}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{row.recoveryDeskAttempts}</td>
                  <td className="py-1.5 pr-3 text-text-secondary">{formatMinorAsRupees(row.naiveAmountRecoveredMinor)}</td>
                  <td className="py-1.5 text-text-secondary">{formatMinorAsRupees(row.recoveryDeskAmountRecoveredMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
