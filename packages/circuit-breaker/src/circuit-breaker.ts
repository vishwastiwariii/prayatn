import { DEFAULT_CIRCUIT_BREAKER_CONFIG, DEFAULT_DRAIN_CONFIG, type DrainConfig } from './config';
import { effectiveState, evaluatePermission, remainingCooldownSeconds } from './state-machine';
import type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitObservation,
  CircuitPermission,
  CircuitStateStore,
  GatewayReliabilityMetrics,
} from './types';

export interface CircuitTransitionInfo {
  reason: string;
  failureCount: number;
  openedAt: number | null;
  atMs: number;
}

/**
 * Called on every state transition so the caller can write an audit event.
 * The breaker itself never touches the database.
 */
export interface CircuitBreakerHooks {
  onOpen?(info: CircuitTransitionInfo & { reopened: boolean }): void | Promise<void>;
  onHalfOpen?(info: CircuitTransitionInfo): void | Promise<void>;
  onClose?(info: CircuitTransitionInfo): void | Promise<void>;
  onProbeSucceeded?(info: CircuitTransitionInfo): void | Promise<void>;
  onProbeFailed?(info: CircuitTransitionInfo): void | Promise<void>;
}

export interface CreateCircuitBreakerOptions {
  store: CircuitStateStore;
  config?: Partial<CircuitBreakerConfig>;
  drain?: Partial<DrainConfig>;
  /** Injected clock (ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Stable per-instance id used as the probe token. */
  instanceId?: string;
  hooks?: CircuitBreakerHooks;
}

let instanceCounter = 0;

export function createCircuitBreaker(opts: CreateCircuitBreakerOptions): CircuitBreaker {
  const config: CircuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...opts.config };
  const drain: DrainConfig = { ...DEFAULT_DRAIN_CONFIG, ...opts.drain };
  const now = opts.now ?? (() => Date.now());
  const store = opts.store;
  const hooks = opts.hooks ?? {};
  instanceCounter += 1;
  const token = opts.instanceId ?? `cb-${process.pid ?? 0}-${instanceCounter}-${now()}`;

  async function transitionInfo(reason: string, atMs: number): Promise<CircuitTransitionInfo> {
    const snap = await store.getState();
    return { reason, failureCount: snap.failureCount, openedAt: snap.openedAt, atMs };
  }

  return {
    async beforeRequest(): Promise<CircuitPermission> {
      const atMs = now();
      let snap = await store.getState();
      const eff = effectiveState(snap, config, atMs);

      if (eff === 'CLOSED') return { allowed: true, isProbe: false };

      if (eff === 'OPEN') {
        const slot = await store.nextBlockedSlot();
        await store.incrementMetric('blockedRecoveryAttempts');
        await store.incrementMetric('queuedDuringOutage');
        const batchDelay = Math.floor(slot / drain.batchSize) * drain.intervalSeconds;
        return {
          allowed: false,
          reason: 'CIRCUIT_OPEN',
          retryAfterSeconds: Math.max(1, remainingCooldownSeconds(snap, config, atMs) + batchDelay),
        };
      }

      // HALF_OPEN — persist the lazy transition, then try to claim the one probe.
      if (snap.state === 'OPEN') {
        const { changed } = await store.enterHalfOpen(atMs);
        if (changed) await hooks.onHalfOpen?.(await transitionInfo('cooldown elapsed', atMs));
        snap = await store.getState();
      }

      if (snap.probeInProgress) {
        return { allowed: false, reason: 'PROBE_ALREADY_IN_PROGRESS', retryAfterSeconds: 5 };
      }

      const acquired = await store.tryAcquireProbe(token);
      if (!acquired) {
        return { allowed: false, reason: 'PROBE_ALREADY_IN_PROGRESS', retryAfterSeconds: 5 };
      }
      await store.incrementMetric('probeAttempts');
      return { allowed: true, isProbe: true };
    },

    async onSuccess(): Promise<void> {
      const atMs = now();
      await store.incrementMetric('gatewayRequests');
      const snap = await store.getState();
      const eff = effectiveState(snap, config, atMs);

      if (snap.state === 'HALF_OPEN' || snap.probeInProgress || eff === 'HALF_OPEN') {
        const info = await transitionInfo('probe succeeded', atMs);
        await hooks.onProbeSucceeded?.(info);
        const { changed } = await store.close();
        await store.releaseProbe(token);
        await store.incrementMetric('successfulProbes');
        if (changed) {
          await store.incrementMetric('resumedAfterRecovery');
          await hooks.onClose?.(await transitionInfo('gateway healthy again', atMs));
        }
      }
      // CLOSED: nothing to do — the rolling window prunes itself.
    },

    async onGatewayFailure(): Promise<void> {
      const atMs = now();
      await store.recordFailure(atMs);
      await store.incrementMetric('gatewayRequests');
      await store.incrementMetric('gatewayFailures');

      const snap = await store.getState();
      const eff = effectiveState(snap, config, atMs);

      if (snap.state === 'HALF_OPEN' || snap.probeInProgress || eff === 'HALF_OPEN') {
        // A probe failed — reopen and restart the cooldown.
        await hooks.onProbeFailed?.(await transitionInfo('probe failed', atMs));
        const { changed } = await store.open('Probe failed: transient gateway failure', atMs);
        await store.releaseProbe(token);
        await store.incrementMetric('failedProbes');
        if (changed) {
          await store.incrementMetric('circuitOpenCount');
          await hooks.onOpen?.({
            ...(await transitionInfo('probe failed: transient gateway failure', atMs)),
            reopened: true,
          });
        }
        return;
      }

      if (snap.state === 'CLOSED' && snap.failureCount >= config.failureThreshold) {
        const reason =
          `Gateway failures exceeded threshold: ${snap.failureCount} failures ` +
          `in ${config.failureWindowSeconds} seconds.`;
        const { changed } = await store.open(reason, atMs);
        if (changed) {
          await store.incrementMetric('circuitOpenCount');
          await hooks.onOpen?.({ ...(await transitionInfo(reason, atMs)), reopened: false });
        }
      }
    },

    async getSnapshot(): Promise<CircuitObservation> {
      const atMs = now();
      const snap = await store.getState();
      const eff = effectiveState(snap, config, atMs);
      return {
        state: eff,
        failureCount: snap.failureCount,
        failureThreshold: config.failureThreshold,
        openedAt: snap.openedAt == null ? null : new Date(snap.openedAt).toISOString(),
        cooldownSeconds: config.openCooldownSeconds,
        remainingCooldownSeconds: remainingCooldownSeconds(snap, config, atMs),
        halfOpenProbeInProgress: snap.probeInProgress,
      };
    },

    async getMetrics(): Promise<GatewayReliabilityMetrics> {
      return store.readMetrics();
    },
  };
}

export { evaluatePermission };
