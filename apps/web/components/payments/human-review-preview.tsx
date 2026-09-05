'use client';

import Link from 'next/link';
import { UserCheck } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { RootCauseBadge } from '@/components/payments/status-badges';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import { ROOT_CAUSE_LABEL } from '@/lib/api/types';
import { formatMinorAsRupees } from '@/lib/format';
import { useHumanReviewQueue } from '@/lib/queries';

/** Phase 12 §26 — the human review queue, with the AI suggestion surfaced. */
export function HumanReviewPreview() {
  const { data, isPending, isError, refetch } = useHumanReviewQueue();

  return (
    <Card>
      <CardHeader
        title="Human review required"
        subtitle={data ? `${data.total} pending` : undefined}
      />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load the human review queue." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<UserCheck size={22} />}
            title="No human reviews required"
            description="Recovery Desk is operating normally."
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.items.slice(0, 6).map((item) => (
              <li key={item.failureId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/payments/${item.paymentId}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {item.paymentId}
                    </Link>
                    <span className="text-xs text-text-muted">{formatMinorAsRupees(item.amountMinor)}</span>
                  </div>
                  <p className="truncate text-xs text-text-muted">{item.errorCode}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-text-muted">Current:</span>
                    <RootCauseBadge cause={item.currentCause} />
                    {item.aiSuggestion && (
                      <>
                        <span className="text-[11px] text-text-muted">→ AI:</span>
                        <span className="text-xs font-medium text-text-primary">
                          {ROOT_CAUSE_LABEL[item.aiSuggestion.cause]}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          ({Math.round(item.aiSuggestion.confidence * 100)}%)
                        </span>
                        <AISourceBadge source="AI" />
                      </>
                    )}
                  </div>
                </div>
                <Link
                  href={`/payments/${item.paymentId}`}
                  className="shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-medium text-text-primary hover:bg-surface-2"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
