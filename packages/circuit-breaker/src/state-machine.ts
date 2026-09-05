import type {
  CircuitBreakerConfig,
  CircuitPermission,
  CircuitSnapshot,
  CircuitState,
} from './types';

/**
 * The circuit state machine — pure and deterministic.
 *
 *   CLOSED  --(failures >= threshold in window)-->  OPEN
 *   OPEN    --(now - openedAt >= cooldown)------->  HALF_OPEN   (lazy, on read)
 *   HALF_OPEN --(probe success)------------------>  CLOSED
 *   HALF_OPEN --(transient gateway failure)------>  OPEN
 *
 * No `setTimeout`. Every time-based transition is derived from timestamps.
 * Nothing here touches Redis; it is handed a `CircuitSnapshot`.
 */

/** The state a request should be evaluated against, accounting for elapsed cooldown. */
export function effectiveState(
  snap: CircuitSnapshot,
  config: CircuitBreakerConfig,
  nowMs: number,
): CircuitState {
  if (snap.state === 'OPEN' && snap.openedAt != null) {
    if (nowMs - snap.openedAt >= config.openCooldownSeconds * 1000) return 'HALF_OPEN';
  }
  return snap.state;
}

/** Seconds remaining before an OPEN circuit becomes probe-eligible. */
export function remainingCooldownSeconds(
  snap: CircuitSnapshot,
  config: CircuitBreakerConfig,
  nowMs: number,
): number {
  if (snap.openedAt == null) return 0;
  const elapsedSec = (nowMs - snap.openedAt) / 1000;
  return Math.max(0, Math.ceil(config.openCooldownSeconds - elapsedSec));
}

/** CLOSED -> OPEN test. */
export function shouldOpen(failureCount: number, config: CircuitBreakerConfig): boolean {
  return failureCount >= config.failureThreshold;
}

/**
 * Pure permission decision. Probe *acquisition* is still atomic in the store;
 * this only says whether a probe is conceptually available.
 */
export function evaluatePermission(
  snap: CircuitSnapshot,
  config: CircuitBreakerConfig,
  nowMs: number,
): CircuitPermission {
  const eff = effectiveState(snap, config, nowMs);

  if (eff === 'CLOSED') return { allowed: true, isProbe: false };

  if (eff === 'OPEN') {
    return {
      allowed: false,
      reason: 'CIRCUIT_OPEN',
      retryAfterSeconds: Math.max(1, remainingCooldownSeconds(snap, config, nowMs)),
    };
  }

  // HALF_OPEN
  if (snap.probeInProgress) {
    return { allowed: false, reason: 'PROBE_ALREADY_IN_PROGRESS', retryAfterSeconds: 5 };
  }
  return { allowed: true, isProbe: true };
}

/**
 * Given a HALF_OPEN circuit and a gateway outcome, what is the next state?
 * (Used for reasoning / tests; the breaker drives the store transitions.)
 */
export function halfOpenTransition(outcome: 'PROBE_SUCCESS' | 'GATEWAY_FAILURE'): CircuitState {
  return outcome === 'PROBE_SUCCESS' ? 'CLOSED' : 'OPEN';
}
