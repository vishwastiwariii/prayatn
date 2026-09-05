/**
 * Circuit breaker domain model — Phase 10.
 *
 * The circuit breaker answers exactly one question: "is it currently safe to
 * call the payment gateway?" It never makes payment decisions.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Transient gateway failures within the window that trip the circuit. */
  failureThreshold: number;
  /** Rolling window (seconds) over which failures are counted. */
  failureWindowSeconds: number;
  /** How long the circuit stays OPEN before a probe is allowed. */
  openCooldownSeconds: number;
  /** Concurrent probes permitted in HALF_OPEN (MVP: 1). */
  halfOpenMaxProbes: number;
}

/** A point-in-time view of the shared circuit state (from the store). */
export interface CircuitSnapshot {
  state: CircuitState;
  /** Failures currently inside the rolling window. */
  failureCount: number;
  /** Epoch ms the circuit last opened, or null. */
  openedAt: number | null;
  reason: string | null;
  /** A probe token is currently held. */
  probeInProgress: boolean;
}

/** The observability shape returned by `CircuitBreaker.getSnapshot()`. */
export interface CircuitObservation {
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  openedAt: string | null;
  cooldownSeconds: number;
  remainingCooldownSeconds: number;
  halfOpenProbeInProgress: boolean;
}

export type CircuitPermission =
  | { allowed: true; isProbe: boolean }
  | {
      allowed: false;
      reason: 'CIRCUIT_OPEN' | 'PROBE_ALREADY_IN_PROGRESS';
      /** Seconds the caller should wait before this action is retried. */
      retryAfterSeconds: number;
    };

export interface CircuitBreaker {
  beforeRequest(): Promise<CircuitPermission>;
  onSuccess(): Promise<void>;
  onGatewayFailure(): Promise<void>;
  getSnapshot(): Promise<CircuitObservation>;
  getMetrics(): Promise<GatewayReliabilityMetrics>;
}

/**
 * Shared circuit state. Redis-specific logic lives in `redis-store.ts`; the pure
 * state machine never touches this — it is handed a `CircuitSnapshot`.
 */
export interface CircuitStateStore {
  getState(): Promise<CircuitSnapshot>;
  /** ZADD the failure timestamp; expire entries older than the window. */
  recordFailure(timestampMs: number): Promise<void>;
  /** Clear the failure window (probe success / manual reset). */
  recordSuccess(): Promise<void>;
  /** Lazily persist OPEN -> HALF_OPEN when the cooldown has elapsed. */
  enterHalfOpen(atMs: number): Promise<{ changed: boolean }>;
  /** Atomically claim the single probe slot. */
  tryAcquireProbe(token: string): Promise<boolean>;
  /** Release the probe slot (compare-and-delete on the token). */
  releaseProbe(token: string): Promise<void>;
  /** Atomically move to OPEN. `changed` is true only for the caller that did it. */
  open(reason: string, atMs: number): Promise<{ changed: boolean }>;
  /** Atomically move to CLOSED and reset counters. `changed` true only once. */
  close(): Promise<{ changed: boolean }>;
  /** Next 0-based slot for staggered queue draining (atomic INCR - 1). */
  nextBlockedSlot(): Promise<number>;
  /** Metric counters (best-effort; never on the hot path's critical section). */
  incrementMetric(name: keyof GatewayReliabilityMetrics, by?: number): Promise<void>;
  readMetrics(): Promise<GatewayReliabilityMetrics>;
  /** Wipe everything (tests / demo setup). */
  reset(): Promise<void>;
}

export interface GatewayReliabilityMetrics {
  gatewayRequests: number;
  gatewayFailures: number;
  circuitOpenCount: number;
  circuitOpenDurationSeconds: number;
  blockedRecoveryAttempts: number;
  probeAttempts: number;
  successfulProbes: number;
  failedProbes: number;
  queuedDuringOutage: number;
  resumedAfterRecovery: number;
  duplicateAttemptsPrevented: number;
}

export const EMPTY_GATEWAY_METRICS: GatewayReliabilityMetrics = {
  gatewayRequests: 0,
  gatewayFailures: 0,
  circuitOpenCount: 0,
  circuitOpenDurationSeconds: 0,
  blockedRecoveryAttempts: 0,
  probeAttempts: 0,
  successfulProbes: 0,
  failedProbes: 0,
  queuedDuringOutage: 0,
  resumedAfterRecovery: 0,
  duplicateAttemptsPrevented: 0,
};
