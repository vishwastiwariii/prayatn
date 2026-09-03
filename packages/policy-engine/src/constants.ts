import { RECOVERY_LIMITS, type RootCause } from '@recovery-desk/domain';
import type { RecoveryHistory, SystemConstraints } from './types';

export const POLICY_ENGINE_VERSION = '1.0.0' as const;

/**
 * Infra + tuning defaults. Anything a caller does not know it can omit; only
 * `now` is mandatory (the engine must be handed its clock).
 */
export const DEFAULT_CONSTRAINTS: Omit<SystemConstraints, 'now'> = {
  killSwitchEngaged: false,
  circuitBreaker: 'CLOSED',
  maxAttempts: RECOVERY_LIMITS.MAX_ATTEMPTS, // 3
  maxMessagesPerDay: RECOVERY_LIMITS.MAX_MESSAGES_PER_DAY, // 2
  quietHoursStart: RECOVERY_LIMITS.QUIET_HOURS_START, // 22
  quietHoursEnd: RECOVERY_LIMITS.QUIET_HOURS_END, // 8
  issuerRetryDelayMinutes: 18,
  gatewayRecheckMinutes: 5,
  circuitCooldownMinutes: 60,
  minClassificationConfidence: 0.5,
  fundsLowFallbackDelayMinutes: 24 * 60,
};

export const EMPTY_HISTORY: RecoveryHistory = {
  retriesExecuted: 0,
  messagesSentInWindow: 0,
  lastMessageAt: null,
  lastAttemptAt: null,
  railSwitched: false,
  mandateRevoked: false,
  priorActions: [],
};

/**
 * Per-cause attempt ceiling (TOTAL attempts, incl. the original charge).
 * A ceiling of 0 means "no automated attempt is ever permitted".
 */
export const CAUSE_MAX_ATTEMPTS: Record<RootCause, number> = {
  CUSTOMER_FUNDS_LOW: 3,
  ISSUER_TEMPORARY_FAILURE: 3,
  GATEWAY_FAILURE: 3,
  CUSTOMER_ABANDONMENT: 2,
  CUSTOMER_AUTH_FAILURE: 2,
  PAYMENT_METHOD_INVALID: 0,
  MANDATE_INVALID: 0,
  UNKNOWN: 0,
};
