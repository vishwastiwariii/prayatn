'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import { decideRecovery } from '@/lib/api/payments';
import { ROOT_CAUSE_LABEL, type RootCause } from '@/lib/api/types';
import { useGenerateAISuggestion, useResolveReview } from '@/lib/queries';
import { useMutation } from '@tanstack/react-query';

const CAUSES: RootCause[] = [
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
];

export interface AISuggestionData {
  cause: RootCause;
  confidence: number;
  explanation: string | null;
}

/**
 * Phase 12 §17-19/§26-27 — the human review workflow: an (optional) AI
 * suggestion the reviewer can accept, reject for a different cause, or keep
 * as unknown. Nothing here schedules or executes a recovery action; "Run
 * policy decision" is a separate, explicit step handed to the existing
 * deterministic `/decide` route.
 */
export function HumanReviewActions({
  failureId,
  paymentId,
  aiSuggestion,
}: {
  failureId: string;
  paymentId: string;
  aiSuggestion: AISuggestionData | null;
}) {
  const [rejectCause, setRejectCause] = useState<RootCause>('ISSUER_TEMPORARY_FAILURE');
  const [showReject, setShowReject] = useState(false);
  const [resolvedCause, setResolvedCause] = useState<RootCause | null>(null);

  const suggest = useGenerateAISuggestion(paymentId);
  const resolve = useResolveReview(paymentId);
  const decide = useMutation({ mutationFn: () => decideRecovery(failureId) });

  function accept() {
    if (!aiSuggestion) return;
    resolve.mutate(
      { failureId, decision: 'ACCEPT', rootCause: aiSuggestion.cause, reason: 'Reviewer confirmed the AI suggestion.' },
      { onSuccess: () => setResolvedCause(aiSuggestion.cause) },
    );
  }

  function reject() {
    resolve.mutate(
      { failureId, decision: 'REJECT', rootCause: rejectCause, reason: 'Reviewer chose a different cause.' },
      { onSuccess: () => setResolvedCause(rejectCause) },
    );
  }

  function keepUnknown() {
    resolve.mutate(
      { failureId, decision: 'KEEP_UNKNOWN', reason: 'Reviewer could not determine a cause.' },
      { onSuccess: () => setResolvedCause('UNKNOWN') },
    );
  }

  return (
    <Card>
      <CardHeader title="Human review" subtitle="A person decides — this never auto-executes a recovery action" />
      <div className="space-y-3 p-4 text-sm">
        {!aiSuggestion && !resolvedCause && (
          <div>
            <p className="text-text-secondary">No AI suggestion yet.</p>
            <button
              onClick={() => suggest.mutate(failureId)}
              disabled={suggest.isPending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              <Sparkles size={13} />
              {suggest.isPending ? 'Asking AI…' : 'Generate AI suggestion'}
            </button>
          </div>
        )}

        {aiSuggestion && !resolvedCause && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                AI suggestion
              </span>
              <AISourceBadge source="AI" />
            </div>
            <p className="mt-1.5 font-medium text-text-primary">
              {ROOT_CAUSE_LABEL[aiSuggestion.cause]}{' '}
              <span className="font-normal text-text-muted">({Math.round(aiSuggestion.confidence * 100)}%)</span>
            </p>
            {aiSuggestion.explanation && (
              <div className="mt-2">
                <p className="text-[11px] uppercase tracking-wide text-text-muted">Why AI suggested this</p>
                <p className="mt-0.5 text-xs text-text-secondary">{aiSuggestion.explanation}</p>
              </div>
            )}
            <p className="mt-2 text-[11px] font-medium text-status-serious">
              AI suggestion only. Human approval required.
            </p>
          </div>
        )}

        {resolvedCause ? (
          <div className="rounded-md border border-status-good bg-status-good-bg px-3 py-2 text-xs text-status-good">
            Recorded as {ROOT_CAUSE_LABEL[resolvedCause]}. Ask the policy engine what to do next when ready.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={accept}
              disabled={!aiSuggestion || resolve.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => setShowReject((v) => !v)}
              disabled={resolve.isPending}
              className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2"
            >
              Reject
            </button>
            <button
              onClick={keepUnknown}
              disabled={resolve.isPending}
              className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2"
            >
              Keep as unknown
            </button>
          </div>
        )}

        {showReject && !resolvedCause && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
            <select
              value={rejectCause}
              onChange={(e) => setRejectCause(e.target.value as RootCause)}
              className="rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs"
            >
              {CAUSES.map((c) => (
                <option key={c} value={c}>
                  {ROOT_CAUSE_LABEL[c]}
                </option>
              ))}
            </select>
            <button
              onClick={reject}
              disabled={resolve.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}

        {resolvedCause && (
          <button
            onClick={() => decide.mutate()}
            disabled={decide.isPending || decide.isSuccess}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
          >
            {decide.isSuccess ? 'Policy decision requested' : 'Run policy decision'}
          </button>
        )}

        {(resolve.isError || decide.isError || suggest.isError) && (
          <p className="text-xs text-status-critical">Something went wrong. Please try again.</p>
        )}
      </div>
    </Card>
  );
}
