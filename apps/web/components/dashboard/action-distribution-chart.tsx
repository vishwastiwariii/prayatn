'use client';

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ACTION_LABEL, ACTION_SLOT, type RecoveryActionType } from '@/lib/api/types';
import { catColor } from '@/lib/palette';
import { useDashboardSummary } from '@/lib/queries';

/** Phase 11 §9 — proof that not every failure gets a retry. */
export function ActionDistributionChart() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  return (
    <Card>
      <CardHeader title="Recovery actions" subtitle="What the policy engine decided to do" />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load recovery actions." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.actions.length === 0 ? (
          <EmptyState title="No decisions yet" description="Recovery actions appear once the policy engine has decided." />
        ) : (
          <div style={{ height: Math.max(160, data.actions.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.actions}
                layout="vertical"
                margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
                barCategoryGap={10}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="action"
                  width={90}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(action: RecoveryActionType) => ACTION_LABEL[action]}
                />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const row = payload[0].payload as {
                      action: RecoveryActionType;
                      count: number;
                      pct: number;
                    };
                    return (
                      <div className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs shadow-md">
                        <p className="font-medium text-text-primary">{ACTION_LABEL[row.action]}</p>
                        <p className="text-text-secondary">
                          {row.count} decisions · {row.pct}%
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {data.actions.map((row) => (
                    <Cell key={row.action} fill={catColor(ACTION_SLOT[row.action])} />
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
