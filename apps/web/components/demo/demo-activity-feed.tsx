'use client';

import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { DemoEvent } from '@/lib/api/demo';

const TONE: Record<string, string> = {
  GATEWAY_STORM_STARTED: 'text-status-critical',
  RECOVERY_BLOCKED_BY_CIRCUIT: 'text-status-critical',
  GATEWAY_HEALTHY: 'text-status-good',
  PAYMENT_RECOVERED: 'text-status-good',
  AI_MESSAGE_GENERATED: 'text-accent',
  AI_SUGGESTION_GENERATED: 'text-accent',
  STAGE_ERROR: 'text-status-critical',
};

/** Phase 13 §25 — the live system activity stream, newest first, bounded. */
export function DemoActivityFeed({ events }: { events: DemoEvent[] }) {
  const ordered = [...events].reverse();

  return (
    <Card>
      <CardHeader title="Live system activity" subtitle="Real events from the running pipeline" />
      <div className="max-h-[28rem] overflow-y-auto">
        {ordered.length === 0 ? (
          <EmptyState title="Nothing yet" description="Start the demo to see live events." />
        ) : (
          <ul className="divide-y divide-border">
            {ordered.map((event) => (
              <li key={event.id} className="px-4 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide ${TONE[event.type] ?? 'text-text-secondary'}`}
                  >
                    {event.type.replaceAll('_', ' ')}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                    {new Date(event.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">{event.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
