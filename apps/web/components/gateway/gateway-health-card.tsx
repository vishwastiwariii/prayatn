'use client';

import type { ReactNode } from 'react';
import { Activity, AlertOctagon, Loader2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import type { CircuitState } from '@/lib/api/gateway';
import { useGatewayCircuit } from '@/lib/queries';
import { cn } from '@/lib/cn';

const STATE_COPY: Record<CircuitState, { label: string; tone: string; dot: string }> = {
  CLOSED: { label: 'HEALTHY', tone: 'text-status-good', dot: 'bg-status-good' },
  OPEN: { label: 'DEGRADED', tone: 'text-status-critical', dot: 'bg-status-critical' },
  HALF_OPEN: { label: 'RECOVERING', tone: 'text-status-warning', dot: 'bg-status-warning' },
};

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

export function GatewayHealthCard() {
  const { data, isPending, isError, refetch } = useGatewayCircuit();

  return (
    <Card>
      <CardHeader
        title="Gateway health"
        action={
          data?.state === 'HALF_OPEN' ? (
            <Loader2 size={14} className="animate-spin text-status-warning" />
          ) : data?.state === 'OPEN' ? (
            <AlertOctagon size={14} className="text-status-critical" />
          ) : (
            <Activity size={14} className="text-status-good" />
          )
        }
      />
      <div className="p-4">
        {isError ? (
          <ErrorState message="Unable to load gateway status." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', STATE_COPY[data.state].dot)} />
              <span className={cn('text-sm font-semibold tracking-wide', STATE_COPY[data.state].tone)}>
                {STATE_COPY[data.state].label}
              </span>
            </div>
            <Row label="Circuit" value={data.state.replace('_', '-')} />
            <Row
              label="Failures"
              value={`${data.failureCount} / ${data.failureThreshold}`}
            />
            {data.state === 'OPEN' && (
              <>
                <Row
                  label="Retries blocked"
                  value={data.metrics?.blockedRecoveryAttempts ?? 0}
                />
                <Row label="Cooldown" value={`${data.remainingCooldownSeconds}s`} />
              </>
            )}
            {data.state === 'HALF_OPEN' && (
              <Row
                label="Probe"
                value={data.halfOpenProbeInProgress ? 'in progress' : `1 / ${data.config?.circuit.halfOpenMaxProbes ?? 1}`}
              />
            )}
            {data.state === 'CLOSED' && <Row label="Last incident" value={data.metrics?.circuitOpenCount ? 'recorded' : 'none'} />}
          </div>
        )}
      </div>
    </Card>
  );
}
