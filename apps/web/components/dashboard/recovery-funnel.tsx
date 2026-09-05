'use client';

import { ChevronRight } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useDashboardSummary } from '@/lib/queries';

const STAGES: Array<{ key: 'initiallyFailed' | 'classified' | 'eligible' | 'attempted' | 'recovered'; label: string }> = [
  { key: 'initiallyFailed', label: 'Initially failed' },
  { key: 'classified', label: 'Classified' },
  { key: 'eligible', label: 'Recovery eligible' },
  { key: 'attempted', label: 'Recovery attempted' },
  { key: 'recovered', label: 'Recovered' },
];

export function RecoveryFunnel() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  return (
    <Card>
      <CardHeader title="Recovery funnel" subtitle="Every stage counted from persisted rows, not derived on the client" />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load the recovery funnel." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="flex items-stretch gap-1">
            {STAGES.map((stage, i) => {
              const value = data.funnel[stage.key];
              const max = data.funnel.initiallyFailed || 1;
              const widthPct = Math.max(6, Math.round((value / max) * 100));
              return (
                <div key={stage.key} className="flex flex-1 items-center gap-1">
                  <div className="flex-1">
                    <p className="text-[11px] text-text-muted">{stage.label}</p>
                    <p className="text-lg font-semibold tabular-nums text-text-primary">
                      {value.toLocaleString('en-IN')}
                    </p>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2">
                      <div
                        className="h-1.5 rounded-full bg-accent"
                        style={{ width: `${widthPct}%`, opacity: 1 - i * 0.14 }}
                      />
                    </div>
                  </div>
                  {i < STAGES.length - 1 && <ChevronRight size={16} className="mt-3 shrink-0 text-text-muted" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
