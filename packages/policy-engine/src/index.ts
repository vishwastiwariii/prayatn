/**
 * `@recovery-desk/policy-engine` — deterministic recovery policy engine (Phase 7).
 *
 *   decide({ payment, failure, classification, customer?, history?, constraints })
 *     -> PolicyDecision { action, intendedAction, delayMinutes, nextEligibleAt,
 *                         maxAttempts, attemptsRemaining, terminal, permitted,
 *                         blockedBy, reason, ... }
 *
 * It decides BOTH what should be done (the playbook) and what is permitted (the
 * guardrail overlay). It is pure and never executes anything.
 */
export const POLICY_ENGINE_PACKAGE = '@recovery-desk/policy-engine' as const;

export { decide, toRecoveryDecision, resolveConstraints, resolveHistory } from './decide';
export type { RecoveryDecisionDto } from './decide';
export { PLAYBOOKS, ALL_PLAYBOOKS } from './playbooks';
export { applyGuardrails } from './guardrails';
export {
  DEFAULT_CONSTRAINTS,
  EMPTY_HISTORY,
  CAUSE_MAX_ATTEMPTS,
  POLICY_ENGINE_VERSION,
} from './constants';
export { addMinutes, minutesUntil, isWithinQuietHours, minutesUntilSalaryWindow } from './time';
export type {
  RecoveryAction,
  CircuitBreakerState,
  PolicyInput,
  PolicyContext,
  PolicyDecision,
  PermissionSet,
  Playbook,
  IntendedDecision,
  PolicyPayment,
  PolicyFailure,
  PolicyClassification,
  PolicyCustomer,
  RecoveryHistory,
  PriorRecoveryAction,
  SystemConstraints,
} from './types';
