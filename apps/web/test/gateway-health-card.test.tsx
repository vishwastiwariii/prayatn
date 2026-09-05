import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayHealthCard } from '@/components/gateway/gateway-health-card';
import type { CircuitView } from '@/lib/api/gateway';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

const baseConfig = {
  circuit: { failureThreshold: 5, failureWindowSeconds: 60, openCooldownSeconds: 30, halfOpenMaxProbes: 1 },
  drain: { batchSize: 5 },
};

function view(overrides: Partial<CircuitView>): CircuitView {
  return {
    state: 'CLOSED',
    failureCount: 0,
    failureThreshold: 5,
    openedAt: null,
    cooldownSeconds: 30,
    remainingCooldownSeconds: 0,
    halfOpenProbeInProgress: false,
    config: baseConfig,
    metrics: {
      gatewayRequests: 10,
      gatewayFailures: 0,
      circuitOpenCount: 0,
      blockedRecoveryAttempts: 0,
      probeAttempts: 0,
      successfulProbes: 0,
    },
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('GatewayHealthCard', () => {
  it('renders CLOSED as HEALTHY', async () => {
    mockFetchByPath({ '/api/gateway/circuit': () => ({ status: 200, body: view({ state: 'CLOSED' }) }) });
    renderWithQueryClient(<GatewayHealthCard />);
    await waitFor(() => expect(screen.getByText('HEALTHY')).toBeInTheDocument());
  });

  it('renders OPEN as DEGRADED and shows blocked retries + cooldown', async () => {
    mockFetchByPath({
      '/api/gateway/circuit': () => ({
        status: 200,
        body: view({
          state: 'OPEN',
          failureCount: 8,
          remainingCooldownSeconds: 18,
          metrics: {
            gatewayRequests: 10,
            gatewayFailures: 8,
            circuitOpenCount: 1,
            blockedRecoveryAttempts: 42,
            probeAttempts: 0,
            successfulProbes: 0,
          },
        }),
      }),
    });
    renderWithQueryClient(<GatewayHealthCard />);
    await waitFor(() => expect(screen.getByText('DEGRADED')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('18s')).toBeInTheDocument();
  });

  it('renders HALF_OPEN as RECOVERING and shows the probe state', async () => {
    mockFetchByPath({
      '/api/gateway/circuit': () => ({ status: 200, body: view({ state: 'HALF_OPEN', halfOpenProbeInProgress: true }) }),
    });
    renderWithQueryClient(<GatewayHealthCard />);
    await waitFor(() => expect(screen.getByText('RECOVERING')).toBeInTheDocument());
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('shows an error state and lets the user retry', async () => {
    mockFetchByPath({ '/api/gateway/circuit': () => ({ status: 500, body: { status: 'ERROR', error: 'boom' } }) });
    renderWithQueryClient(<GatewayHealthCard />);
    await waitFor(() => expect(screen.getByText('Unable to load gateway status.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
