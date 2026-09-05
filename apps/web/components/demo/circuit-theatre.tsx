'use client';

import { ShieldCheck, ShieldAlert, Activity } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CircuitState } from '@/lib/api/gateway';
import type { DemoCounters } from '@/lib/api/demo';
import { cn } from '@/lib/cn';
import { useGatewayCircuit } from '@/lib/queries';

const STATE_COPY: Record<
  CircuitState,
  { label: string; tone: string; ring: string; line: string }
> = {
  CLOSED: {
    label: 'CLOSED',
    tone: 'text-status-good',
    ring: 'border-status-good/40 bg-status-good-bg',
    line: 'Normal traffic. Every recovery attempt reaches the gateway.',
  },
  OPEN: {
    label: 'OPEN',
    tone: 'text-status-critical',
    ring: 'border-status-critical/40 bg-status-critical-bg',
    line: 'The gateway is unhealthy. Retrying now would amplify the outage.',
  },
  HALF_OPEN: {
    label: 'HALF-OPEN',
    tone: 'text-status-warning',
    ring: 'border-status-warning/40 bg-status-warning-bg',
    line: 'Cooldown elapsed. Exactly one probe request is allowed through.',
  },
};

/**
 * Phase 13 §11-13 — the reliability moment. Every number here is read from
 * the live Redis-backed breaker via `GET /api/gateway/circuit`; nothing is
 * scripted, and there is no endpoint that could force a state.
 */
export function CircuitTheatre({ counters }: { counters: DemoCounters }) {
  const { data, isPending } = useGatewayCircuit();

  if (isPending || !data) {
    return (
      <Card>
        <CardHeader title="Gateway circuit" />
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  }

  const copy = STATE_COPY[data.state];
  const Icon = data.state === 'CLOSED' ? ShieldCheck : data.state === 'OPEN' ? ShieldAlert : Activity;

  return (
    <Card>
      <CardHeader title="Gateway circuit" subtitle="Shared across workers via Redis" />
      <div className="space-y-3 p-4">
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors duration-500',
            copy.ring,
          )}
        >
          <Icon size={22} className={copy.tone} />
          <div>
            <p className={cn('text-lg font-semibold tracking-wide', copy.tone)}>{copy.label}</p>
            <p className="text-xs text-text-secondary">{copy.line}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Metric label="Failures" value={`${data.failureCount} / ${data.failureThreshold}`} />
          <Metric label="Gateway calls blocked" value={String(data.metrics?.blockedRecoveryAttempts ?? 0)} />
          <Metric
            label="Cooldown"
            value={data.state === 'OPEN' ? `${data.remainingCooldownSeconds}s` : '—'}
          />
          <Metric
            label="Probe"
            value={data.state === 'HALF_OPEN' ? (data.halfOpenProbeInProgress ? 'running' : '1 allowed') : '—'}
          />
        </div>

        {data.state !== 'CLOSED' && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Blocked ≠ lost
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {counters.queued} recovery action{counters.queued === 1 ? '' : 's'} are still queued and
              rescheduled. The system postponed them — it did not abandon the payments.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}
