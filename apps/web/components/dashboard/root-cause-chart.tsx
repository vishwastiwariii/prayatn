'use client';

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ROOT_CAUSE_LABEL, ROOT_CAUSE_SLOT, type RootCause } from '@/lib/api/types';
import { catColor } from '@/lib/palette';
import { useDashboardSummary } from '@/lib/queries';

export function RootCauseChart() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  return (
    <Card>
      <CardHeader title="Why are payments failing?" subtitle="Deterministic root-cause classification" />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load root-cause breakdown." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.rootCauses.length === 0 ? (
          <EmptyState title="No classified failures yet" description="Root causes appear once failures are classified." />
        ) : (
          <div style={{ height: Math.max(160, data.rootCauses.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.rootCauses}
                layout="vertical"
                margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
                barCategoryGap={10}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="cause"
                  width={130}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(cause: RootCause) => ROOT_CAUSE_LABEL[cause]}
                />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const row = payload[0].payload as { cause: RootCause; count: number; pct: number };
                    return (
                      <div className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs shadow-md">
                        <p className="font-medium text-text-primary">{ROOT_CAUSE_LABEL[row.cause]}</p>
                        <p className="text-text-secondary">
                          {row.count} failures · {row.pct}%
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {data.rootCauses.map((row) => (
                    <Cell key={row.cause} fill={catColor(ROOT_CAUSE_SLOT[row.cause])} />
                  ))}
                  <LabelList
                    dataKey="pct"
                    position="right"
                    formatter={(v: unknown) => `${Number(v) || 0}%`}
                    style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}
