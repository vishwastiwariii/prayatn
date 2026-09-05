import {
  type CircuitBreaker,
  DEFAULT_GATEWAY_RELIABILITY_SETTINGS,
  createCircuitBreaker,
  createRedisCircuitStore,
} from '@recovery-desk/circuit-breaker';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Phase 10 §15 — gateway circuit observability.
 *
 *   GET /api/gateway/circuit
 *
 * READ ONLY. There is deliberately no route to force the circuit state.
 */
export interface GatewayRouteDeps {
  circuitBreaker?: CircuitBreaker;
}

export function createGatewayRoutes(deps: GatewayRouteDeps = {}): FastifyPluginAsync {
  return async (app) => {
    const cb =
      deps.circuitBreaker ??
      createCircuitBreaker({
        store: createRedisCircuitStore({
          redis: app.redis,
          failureWindowSeconds: DEFAULT_GATEWAY_RELIABILITY_SETTINGS.circuit.failureWindowSeconds,
        }),
      });

    app.get('/api/gateway/circuit', async () => {
      const [snapshot, metrics] = await Promise.all([cb.getSnapshot(), cb.getMetrics()]);
      return {
        state: snapshot.state,
        failureCount: snapshot.failureCount,
        failureThreshold: snapshot.failureThreshold,
        openedAt: snapshot.openedAt,
        cooldownSeconds: snapshot.cooldownSeconds,
        remainingCooldownSeconds: snapshot.remainingCooldownSeconds,
        halfOpenProbeInProgress: snapshot.halfOpenProbeInProgress,
        config: DEFAULT_GATEWAY_RELIABILITY_SETTINGS,
        metrics,
      };
    });
  };
}
