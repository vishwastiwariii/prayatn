'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Nav } from '@/components/nav';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { RecoveryStatusBadge } from '@/components/payments/status-badges';
import { FailureCard } from '@/components/payments/failure-card';
import { ClassificationCard } from '@/components/payments/classification-card';
import { HumanReviewActions } from '@/components/payments/human-review-actions';
import { PolicyDecisionCard } from '@/components/recovery/policy-decision-card';
import { CustomerMessageCard } from '@/components/recovery/customer-message-card';
import { RecoveryTimeline } from '@/components/recovery/recovery-timeline';
import { formatMinorAsRupees } from '@/lib/format';
import { usePaymentDetail } from '@/lib/queries';

export function PaymentDetailView({ paymentId }: { paymentId: string }) {
  const { data, isPending, isError, refetch } = usePaymentDetail(paymentId);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary">
          <ArrowLeft size={13} /> Back to overview
        </Link>

        {isError ? (
          <ErrorState message="Unable to load this payment." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">Payment {data.payment.id}</h1>
                <p className="text-sm text-text-secondary">
                  {formatMinorAsRupees(data.payment.amountMinor)} {data.payment.currency} · {data.payment.method}
                  {data.customer && <> · {data.customer.name}</>}
                </p>
              </div>
              <RecoveryStatusBadge status={data.payment.recoveryStatus} />
            </div>

            {data.failures.length === 0 ? (
              <EmptyState title="No failures recorded for this payment" />
            ) : (
              data.failures.map((failure) => {
                const ruleClassification = failure.classifications.find((c) => c.source === 'RULE') ?? null;
                const humanClassification = failure.classifications.find((c) => c.source === 'HUMAN') ?? null;
                const aiSuggestion = failure.classifications.find((c) => c.source === 'LLM_SUGGESTION') ?? null;
                const officialClassification = humanClassification ?? ruleClassification;
                const needsHumanReview = data.payment.recoveryStatus === 'HUMAN_REVIEW' && !humanClassification;
                const latestAction = officialClassification
                  ? data.recoveryActions.find((a) => a.cause === officialClassification.cause)
                  : undefined;
                const message = latestAction
                  ? data.messages.find((m) => m.recoveryActionId === latestAction.id)
                  : undefined;

                return (
                  <div key={failure.id} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <FailureCard failure={failure} />
                      {officialClassification ? (
                        <ClassificationCard classification={officialClassification} />
                      ) : (
                        <EmptyState title="Not classified yet" />
                      )}
                      {needsHumanReview ? (
                        <HumanReviewActions
                          failureId={failure.id}
                          paymentId={data.payment.id}
                          aiSuggestion={
                            aiSuggestion
                              ? {
                                  cause: aiSuggestion.cause,
                                  confidence: aiSuggestion.confidence,
                                  explanation: aiSuggestion.explanation,
                                }
                              : null
                          }
                        />
                      ) : latestAction ? (
                        <PolicyDecisionCard action={latestAction} />
                      ) : (
                        <EmptyState title="No policy decision yet" />
                      )}
                    </div>

                    {latestAction?.requiresCustomerMessage && (
                      <div className="grid grid-cols-1 lg:grid-cols-3">
                        <div className="lg:col-span-1">
                          <CustomerMessageCard action={latestAction} message={message} paymentId={data.payment.id} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            <RecoveryTimeline events={data.auditTimeline} />
          </>
        )}
      </main>
    </div>
  );
}
