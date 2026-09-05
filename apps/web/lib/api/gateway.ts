import { apiFetch } from './client';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitView {
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  openedAt: string | null;
  cooldownSeconds: number;
  remainingCooldownSeconds: number;
  halfOpenProbeInProgress: boolean;
  config?: {
    circuit: {
      failureThreshold: number;
      failureWindowSeconds: number;
      openCooldownSeconds: number;
      halfOpenMaxProbes: number;
    };
    drain: { batchSize: number };
  };
  metrics?: {
    gatewayRequests: number;
    gatewayFailures: number;
    circuitOpenCount: number;
    blockedRecoveryAttempts: number;
    probeAttempts: number;
    successfulProbes: number;
  };
}

export function getGatewayCircuit(signal?: AbortSignal): Promise<CircuitView> {
  return apiFetch<CircuitView>('/api/gateway/circuit', { signal });
}
