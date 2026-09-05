'use client';

import { ShieldAlert } from 'lucide-react';
import { useGatewayCircuit } from '@/lib/queries';

/**
 * Phase 11 §6 — the key demo moment: the system is intentionally doing
 * nothing because doing nothing is safer.
 */
export function GatewayIncidentBanner() {
  const { data } = useGatewayCircuit();
  if (!data || data.state !== 'OPEN') return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-critical/30 bg-status-critical-bg px-4 py-3">
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-status-critical" />
      <div className="text-sm">
        <p className="font-semibold text-status-critical">Gateway protection active</p>
        <p className="mt-0.5 text-text-secondary">
          Recovery Desk has temporarily blocked payment retries because the gateway is experiencing
          elevated failures.{' '}
          <span className="font-medium text-text-primary">
            {data.metrics?.blockedRecoveryAttempts ?? 0} recovery attempts
          </span>{' '}
          are safely queued. Next probe in{' '}
          <span className="font-medium text-text-primary">{data.remainingCooldownSeconds}s</span>.
        </p>
      </div>
    </div>
  );
}
