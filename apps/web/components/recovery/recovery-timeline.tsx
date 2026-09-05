import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import type { PaymentDetail } from '@/lib/api/payments';

/** Phase 11 §17 — the audit trail rendered as a vertical timeline. */
export function RecoveryTimeline({ events }: { events: PaymentDetail['auditTimeline'] }) {
  return (
    <Card>
      <CardHeader title="Audit timeline" subtitle="Append-only — nothing here is ever edited or deleted" />
      <div className="p-4">
        {events.length === 0 ? (
          <EmptyState title="No audit events yet" />
        ) : (
          <ol className="relative border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="mb-5 last:mb-0">
                <span className="absolute -left-[4.5px] mt-1 h-2 w-2 rounded-full bg-accent" />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-primary">
                    {e.eventType.replaceAll('_', ' ')}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                    {formatDateTime(e.createdAt)}
                  </span>
                </div>
                <dl className="mt-1 space-y-0.5 text-xs">
                  <Row label="What we saw" value={e.whatWeSaw} />
                  <Row label="What we concluded" value={e.whatWeConcluded} />
                  <Row label="What we were allowed to do" value={e.whatWasAllowed} />
                  <Row label="What we did" value={e.whatWeDid} />
                  <Row label="What happened" value={e.whatHappened} />
                </dl>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-text-muted">{label}:</dt>
      <dd className="text-text-secondary">{value}</dd>
    </div>
  );
}
