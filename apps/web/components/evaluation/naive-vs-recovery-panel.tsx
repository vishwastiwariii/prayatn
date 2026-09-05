'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { formatMinorAsRupees, formatPct } from '@/lib/format';
import { catColor } from '@/lib/palette';
import { useEvaluation } from '@/lib/queries';

const NAIVE_COLOR = catColor(8);
const RD_COLOR = catColor(1);

function MiniCompare({ title, naive, recoveryDesk, formatter }: { title: string; naive: number; recoveryDesk: number; formatter: (n: number) => string }) {
  const data = [
    { label: 'Naive', value: naive },
    { label: 'Recovery Desk', value: recoveryDesk },
  ];
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-text-muted">{title}</p>
      <div style={{ height: 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={82}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
              <Cell fill={NAIVE_COLOR} />
              <Cell fill={RD_COLOR} />
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v: unknown) => formatter(Number(v) || 0)}
                style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function NaiveVsRecoveryPanel({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError, refetch } = useEvaluation({
    seed: DEFAULT_EVALUATION_SEED,
    count: DEFAULT_EVALUATION_COUNT,
  });

  return (
    <Card>
      <CardHeader
        title="Naive vs Recovery Desk"
        subtitle={`Same ${DEFAULT_EVALUATION_COUNT} seeded failures, same hidden state, only the strategy changes`}
      />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load the evaluation." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="pb-1.5 font-medium">Metric</th>
                    <th className="pb-1.5 font-medium">Naive</th>
                    <th className="pb-1.5 font-medium">Recovery Desk</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <Row label="Recovered" a={data.headline.naive.recoveredCount} b={data.headline.recoveryDesk.recoveredCount} />
                  <Row label="Recovery rate" a={formatPct(data.headline.naive.recoveryRatePct)} b={formatPct(data.headline.recoveryDesk.recoveryRatePct)} />
                  <Row label="₹ Recovered" a={formatMinorAsRupees(data.headline.naive.amountRecoveredMinor)} b={formatMinorAsRupees(data.headline.recoveryDesk.amountRecoveredMinor)} />
                  <Row label="Attempts" a={data.headline.naive.attemptsConsumed} b={data.headline.recoveryDesk.attemptsConsumed} />
                  <Row label="Messages" a={data.headline.naive.messagesSent} b={data.headline.recoveryDesk.messagesSent} />
                  <Row
                    label="Cost / recovery"
                    a={data.headline.naive.costPerRecoveryMinor == null ? '—' : formatMinorAsRupees(data.headline.naive.costPerRecoveryMinor)}
                    b={data.headline.recoveryDesk.costPerRecoveryMinor == null ? '—' : formatMinorAsRupees(data.headline.recoveryDesk.costPerRecoveryMinor)}
                  />
                  <Row label="Hard stops" a={data.headline.naive.hardStops} b={data.headline.recoveryDesk.hardStops} />
                  <Row label="Human review" a={data.headline.naive.humanReviews} b={data.headline.recoveryDesk.humanReviews} />
                </tbody>
              </table>
            </div>

            {!compact && (
              <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <MiniCompare
                  title="Recovery rate"
                  naive={data.headline.naive.recoveryRatePct}
                  recoveryDesk={data.headline.recoveryDesk.recoveryRatePct}
                  formatter={(v) => `${v}%`}
                />
                <MiniCompare
                  title="Attempts"
                  naive={data.headline.naive.attemptsConsumed}
                  recoveryDesk={data.headline.recoveryDesk.attemptsConsumed}
                  formatter={(v) => v.toLocaleString('en-IN')}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, a, b }: { label: string; a: ReactNode; b: ReactNode }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 text-text-secondary">{label}</td>
      <td className="py-1.5 font-medium text-text-primary">{a}</td>
      <td className="py-1.5 font-medium text-text-primary">{b}</td>
    </tr>
  );
}
