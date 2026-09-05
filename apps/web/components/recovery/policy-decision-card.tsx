'use client';

import { Sparkles } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import { ActionBadge } from '@/components/payments/status-badges';
import { formatDateTime } from '@/lib/format';
import type { PaymentDetail } from '@/lib/api/payments';
import { useGenerateMerchantExplanation } from '@/lib/queries';

export function PolicyDecisionCard({ action }: { action: PaymentDetail['recoveryActions'][number] }) {
  const explain = useGenerateMerchantExplanation();

  return (
    <Card>
      <CardHeader title="Recovery decision" subtitle="Produced by the deterministic policy engine — never an LLM" />
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center justify-between">
          <ActionBadge action={action.action} />
          <span className="text-xs text-text-muted">{action.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Field label="Delay" value={action.delayMinutes != null ? `${action.delayMinutes} minutes` : '—'} />
          <Field
            label="Attempts"
            value={`${action.attemptNumber}${action.maxAttempts ? ` / ${action.maxAttempts}` : ''}`}
          />
          <Field label="Scheduled for" value={action.scheduledFor ? formatDateTime(action.scheduledFor) : '—'} />
          <Field label="Executed at" value={action.executedAt ? formatDateTime(action.executedAt) : 'not yet'} />
        </div>
        {action.reason && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Reason</p>
            <p className="mt-0.5 text-text-secondary">{action.reason}</p>
          </div>
        )}
        {action.outcome && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Outcome</p>
            <p className="mt-0.5 font-medium text-text-primary">{action.outcome.status}</p>
            {action.outcome.failureReason && (
              <p className="text-xs text-text-secondary">{action.outcome.failureReason}</p>
            )}
          </div>
        )}

        <div className="border-t border-border pt-3">
          {explain.data ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-text-muted">Merchant explanation</p>
                <AISourceBadge source={explain.data.source} />
              </div>
              <p className="font-medium text-text-primary">{explain.data.explanation.summary}</p>
              <p className="text-text-secondary">{explain.data.explanation.explanation}</p>
            </div>
          ) : (
            <button
              onClick={() => explain.mutate(action.id)}
              disabled={explain.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              <Sparkles size={13} />
              {explain.isPending ? 'Explaining…' : 'Explain this decision'}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums text-text-primary">{value}</p>
    </div>
  );
}
