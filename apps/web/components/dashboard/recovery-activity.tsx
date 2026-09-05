'use client';

import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/format';
import { useDashboardSummary } from '@/lib/queries';

export function RecoveryActivity() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  return (
    <Card>
      <CardHeader title="Recovery activity" subtitle="Live audit trail, most recent first" />
      <div className="max-h-80 overflow-y-auto">
        {isError ? (
          <div className="p-4">
            <ErrorState message="Unable to load recovery activity." onRetry={() => refetch()} />
          </div>
        ) : isPending || !data ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.recentActivity.length === 0 ? (
          <EmptyState
            title="No recovery activity yet"
            description="Once failures are ingested and classified, decisions will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.recentActivity.map((item) => (
              <li key={item.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  {item.paymentId ? (
                    <Link
                      href={`/payments/${item.paymentId}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {item.paymentId}
                    </Link>
                  ) : (
                    <span className="text-xs font-medium text-text-muted">gateway</span>
                  )}
                  <span className="text-[11px] tabular-nums text-text-muted">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">{item.whatWeConcluded}</p>
                <p className="text-[11px] text-text-muted">→ {item.whatWeDid}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
