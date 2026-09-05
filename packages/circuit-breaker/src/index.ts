/**
 * `@recovery-desk/circuit-breaker` — a deterministic, Redis-backed circuit
 * breaker around the payment gateway (Phase 10).
 *
 *   Recovery Action -> Retry Executor -> Circuit Breaker -> Gateway
 *
 * Its only responsibility: "is it currently safe to call the gateway?" It never
 * makes payment decisions and never runs a policy.
 */
export const CIRCUIT_BREAKER_PACKAGE = '@recovery-desk/circuit-breaker' as const;

export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitSnapshot,
  CircuitObservation,
  CircuitPermission,
  CircuitBreaker,
  CircuitStateStore,
  GatewayReliabilityMetrics,
} from './types';
export { EMPTY_GATEWAY_METRICS } from './types';

export {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_DRAIN_CONFIG,
  DEFAULT_GATEWAY_RELIABILITY_SETTINGS,
  PROBE_LOCK_TTL_SECONDS,
} from './config';
export type { DrainConfig, GatewayReliabilitySettings } from './config';

export {
  effectiveState,
  evaluatePermission,
  remainingCooldownSeconds,
  shouldOpen,
  halfOpenTransition,
} from './state-machine';

export { createCircuitBreaker } from './circuit-breaker';
export type {
  CreateCircuitBreakerOptions,
  CircuitBreakerHooks,
  CircuitTransitionInfo,
} from './circuit-breaker';

export { createInMemoryCircuitStore } from './memory-store';
export type { MemoryStoreOptions } from './memory-store';

export { createRedisCircuitStore } from './redis-store';
export type { RedisCircuitStoreOptions } from './redis-store';

export {
  type GatewayResult,
  isGatewayFailureCode,
  toGatewayResult,
  isTransientGatewayFailure,
} from './gateway-result';

export { CircuitOpenError, ProbeInProgressError, GatewayInfrastructureError } from './errors';

/** Audit event types emitted for circuit transitions (Phase 10 §13). */
export const CIRCUIT_AUDIT_EVENTS = {
  OPENED: 'CIRCUIT_OPENED',
  HALF_OPEN: 'CIRCUIT_HALF_OPEN',
  CLOSED: 'CIRCUIT_CLOSED',
  BLOCKED_RECOVERY: 'RECOVERY_BLOCKED_BY_CIRCUIT',
  PROBE_SUCCEEDED: 'CIRCUIT_PROBE_SUCCEEDED',
  PROBE_FAILED: 'CIRCUIT_PROBE_FAILED',
} as const;
