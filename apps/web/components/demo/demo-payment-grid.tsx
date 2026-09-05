'use client';

import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ActionBadge, RootCauseBadge } from '@/components/payments/status-badges';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import type { DemoPaymentView, DemoStage } from '@/lib/api/demo';
import { formatMinorAsRupees } from '@/lib/format';
import { stageAtLeast } from './stage-order';

/**
 * The twelve demo payments, revealed progressively: the failure first, then
 * the diagnosis, then the decision. Every value is read from the API — the
 * only thing the stage controls is how much of it is on screen.
 */
export function DemoPaymentGrid({
  payments,
  stage,
}: {
  payments: DemoPaymentView[];
  stage: DemoStage;
}) {
  const showClassification = stageAtLeast(stage, 'CLASSIFICATION');
  const showDecision = stageAtLeast(stage, 'RECOVERY_DECISIONS');

  return (
    <Card>
      <CardHeader
        title="Payments"
        subtitle={
          showDecision
            ? 'Same twelve failures — six different recovery strategies'
            : showClassification
              ? 'Deterministic rules, with confidence and the rule that fired'
              : 'Real records, ingested through the real API'
        }
      />
      <div className="p-2">
        {payments.length === 0 ? (
          <EmptyState title="No demo payments yet" description="Start the demo to load the dataset." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-2 py-2 font-medium">Payment</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Failure</th>
                  {showClassification && <th className="px-2 py-2 font-medium">Root cause</th>}
                  {showClassification && <th className="px-2 py-2 font-medium">Conf.</th>}
                  {showDecision && <th className="px-2 py-2 font-medium">Decision</th>}
                  {showDecision && <th className="px-2 py-2 font-medium">Status</th>}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {payments.map((p) => (
                  <tr key={p.paymentId} className="border-b border-border last:border-0 align-top">
                    <td className="px-2 py-2">
                      <Link
                        href={`/payments/${p.paymentId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {p.paymentId.replace('demo_', '')}
                      </Link>
                      <p className="text-[11px] text-text-muted">{p.method}</p>
                    </td>
                    <td className="px-2 py-2 text-text-primary">{formatMinorAsRupees(p.amountMinor)}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono text-[11px] text-text-secondary">
                        {p.failure?.reason ?? '—'}
                      </span>
                      {p.note && <p className="mt-0.5 max-w-[22rem] text-[11px] text-text-muted">{p.note}</p>}
                    </td>
                    {showClassification && (
                      <td className="px-2 py-2">
                        <RootCauseBadge cause={p.classification?.cause ?? null} />
                        {p.aiSuggestion && (
                          <div className="mt-1 flex items-center gap-1">
                            <AISourceBadge source="AI" />
                          </div>
                        )}
                      </td>
                    )}
                    {showClassification && (
                      <td className="px-2 py-2 text-text-secondary">
                        {p.classification?.confidence != null
                          ? `${Math.round(p.classification.confidence * 100)}%`
                          : '—'}
                      </td>
                    )}
                    {showDecision && (
                      <td className="px-2 py-2">
                        <ActionBadge action={p.action?.action ?? null} />
                        {p.action?.delayMinutes != null && p.action.delayMinutes > 0 && (
                          <p className="mt-0.5 text-[11px] text-text-muted">
                            in {formatDelay(p.action.delayMinutes)}
                          </p>
                        )}
                      </td>
                    )}
                    {showDecision && (
                      <td className="px-2 py-2 text-[11px] text-text-secondary">
                        {p.recoveryStatus ?? p.status}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function formatDelay(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}
