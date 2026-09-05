'use client';

import { MessageSquare } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { PaymentDetail } from '@/lib/api/payments';
import { useGenerateCustomerMessage } from '@/lib/queries';

/**
 * Phase 12 §9/§24 — the customer message Recovery Desk generated for an
 * already-approved recovery action. Only rendered when the deterministic
 * policy decision requested one (`requiresCustomerMessage`); AI is never
 * called otherwise (§8).
 */
export function CustomerMessageCard({
  action,
  message,
  paymentId,
}: {
  action: PaymentDetail['recoveryActions'][number];
  message: PaymentDetail['messages'][number] | undefined;
  paymentId: string;
}) {
  const generate = useGenerateCustomerMessage(paymentId);
  const resolvedMessage = generate.data?.message ?? message;

  return (
    <Card>
      <CardHeader
        title="Customer message"
        subtitle="Policy requested customer contact for this decision"
        action={resolvedMessage ? <AISourceBadge source={resolvedMessage.source} /> : undefined}
      />
      <div className="p-4 text-sm">
        {resolvedMessage ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap text-text-primary">{resolvedMessage.content}</p>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span>{resolvedMessage.language}</span>
              <span>·</span>
              <span>{resolvedMessage.channel}</span>
            </div>
            <p className="text-[11px] text-text-muted">{resolvedMessage.reason}</p>
          </div>
        ) : (
          <div>
            <EmptyState
              icon={<MessageSquare size={22} />}
              title="No message generated yet"
              description="Generate a customer-facing message for this already-approved action."
            />
            <div className="flex justify-center">
              <button
                onClick={() => generate.mutate(action.id)}
                disabled={generate.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                {generate.isPending ? 'Generating…' : 'Generate message'}
              </button>
            </div>
            {generate.isError && (
              <p className="mt-2 text-center text-xs text-status-critical">Unable to generate a message.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
