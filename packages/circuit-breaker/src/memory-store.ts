import { EMPTY_GATEWAY_METRICS } from './types';
import type {
  CircuitSnapshot,
  CircuitState,
  CircuitStateStore,
  GatewayReliabilityMetrics,
} from './types';

export interface MemoryStoreOptions {
  failureWindowSeconds: number;
  probeLockTtlSeconds: number;
  now?: () => number;
}

/**
 * Reference `CircuitStateStore` backed by plain memory. Used by every unit test
 * and by single-process contexts. The Redis store mirrors this behaviour with
 * atomic operations for the multi-worker case.
 */
export function createInMemoryCircuitStore(opts: MemoryStoreOptions): CircuitStateStore {
  const now = opts.now ?? (() => Date.now());
  let state: CircuitState = 'CLOSED';
  let openedAt: number | null = null;
  let reason: string | null = null;
  let failures: number[] = [];
  let probeToken: string | null = null;
  let probeAcquiredAt = 0;
  let blockedSeq = 0;
  const metrics: GatewayReliabilityMetrics = { ...EMPTY_GATEWAY_METRICS };

  const windowMs = opts.failureWindowSeconds * 1000;
  const probeTtlMs = opts.probeLockTtlSeconds * 1000;

  const prune = (): void => {
    const cutoff = now() - windowMs;
    failures = failures.filter((t) => t >= cutoff);
    if (probeToken && now() - probeAcquiredAt >= probeTtlMs) probeToken = null;
  };

  return {
    async getState(): Promise<CircuitSnapshot> {
      prune();
      return {
        state,
        failureCount: failures.length,
        openedAt,
        reason,
        probeInProgress: probeToken != null,
      };
    },

    async recordFailure(timestampMs) {
      failures.push(timestampMs);
      prune();
    },

    async recordSuccess() {
      failures = [];
    },

    async enterHalfOpen() {
      if (state === 'OPEN') {
        state = 'HALF_OPEN';
        return { changed: true };
      }
      return { changed: false };
    },

    async tryAcquireProbe(token) {
      prune();
      if (probeToken != null) return false;
      probeToken = token;
      probeAcquiredAt = now();
      return true;
    },

    async releaseProbe(token) {
      if (probeToken === token) probeToken = null;
    },

    async open(openReason, atMs) {
      if (state === 'OPEN') return { changed: false };
      state = 'OPEN';
      openedAt = atMs;
      reason = openReason;
      probeToken = null;
      return { changed: true };
    },

    async close() {
      const wasOpen = state !== 'CLOSED';
      if (wasOpen && openedAt != null) {
        metrics.circuitOpenDurationSeconds += Math.max(0, Math.round((now() - openedAt) / 1000));
      }
      state = 'CLOSED';
      openedAt = null;
      reason = null;
      failures = [];
      probeToken = null;
      blockedSeq = 0;
      return { changed: wasOpen };
    },

    async nextBlockedSlot() {
      const slot = blockedSeq;
      blockedSeq += 1;
      return slot;
    },

    async incrementMetric(name, by = 1) {
      metrics[name] += by;
    },

    async readMetrics() {
      return { ...metrics };
    },

    async reset() {
      state = 'CLOSED';
      openedAt = null;
      reason = null;
      failures = [];
      probeToken = null;
      blockedSeq = 0;
      for (const k of Object.keys(metrics) as (keyof GatewayReliabilityMetrics)[]) metrics[k] = 0;
    },
  };
}
