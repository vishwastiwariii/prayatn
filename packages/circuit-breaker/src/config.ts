import type { CircuitBreakerConfig } from './types';

/**
 * Deterministic defaults. These are the ONLY place these numbers live — nothing
 * downstream should hard-code a threshold or a cooldown.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindowSeconds: 60,
  openCooldownSeconds: 30,
  halfOpenMaxProbes: 1,
};

/** Controlled queue drain after the circuit recovers (Phase 10 §10). */
export interface DrainConfig {
  /** Jobs released per scheduling interval when the circuit reopens the gateway. */
  batchSize: number;
  /** Gap (seconds) between released batches. */
  intervalSeconds: number;
}

export const DEFAULT_DRAIN_CONFIG: DrainConfig = {
  batchSize: 5,
  intervalSeconds: 5,
};

/** How long a probe token is held before it auto-expires (safety net). */
export const PROBE_LOCK_TTL_SECONDS = 20;

/** Shared config bundle surfaced to the demo / dashboard (Phase 10 §12). */
export interface GatewayReliabilitySettings {
  circuit: CircuitBreakerConfig;
  drain: DrainConfig;
}

export const DEFAULT_GATEWAY_RELIABILITY_SETTINGS: GatewayReliabilitySettings = {
  circuit: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  drain: DEFAULT_DRAIN_CONFIG,
};
