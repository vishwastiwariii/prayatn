import type { RecoveryActions, RootCause } from '@recovery-desk/domain';
import { DEFAULT_CONSTRAINTS, EMPTY_HISTORY } from './constants';
import { applyGuardrails } from './guardrails';
import { PLAYBOOKS } from './playbooks';
import type {
  PolicyContext,
  PolicyCustomer,
  PolicyDecision,
  PolicyInput,
  RecoveryHistory,
  SystemConstraints,
} from './types';

const EMPTY_CUSTOMER: PolicyCustomer = {
  salaryDay: null,
  balanceState: null,
  preferredLanguage: null,
};

export function resolveConstraints(
  partial: Partial<SystemConstraints> & Pick<SystemConstraints, 'now'>,
): SystemConstraints {
  if (!(partial.now instanceof Date) || Number.isNaN(partial.now.getTime())) {
    throw new TypeError('policy-engine: constraints.now must be a valid Date');
  }
  return { ...DEFAULT_CONSTRAINTS, ...partial };
}

export function resolveHistory(partial: Partial<RecoveryHistory> | undefined): RecoveryHistory {
  return { ...EMPTY_HISTORY, ...(partial ?? {}), priorActions: partial?.priorActions ?? [] };
}

function resolveContext(input: PolicyInput): PolicyContext {
  return {
    payment: input.payment,
    failure: input.failure,
    classification: input.classification,
    customer: { ...EMPTY_CUSTOMER, ...(input.customer ?? {}) },
    history: resolveHistory(input.history),
    constraints: resolveConstraints(input.constraints),
  };
}

/**
 * The policy engine entry point.
 *
 *   Payment + Failure + Classification + Recovery History + Constraints
 *        -> pick the playbook for the classified root cause   (what to do)
 *        -> apply the guardrail overlay                        (what is permitted)
 *        -> a single deterministic PolicyDecision
 *
 * Pure: identical inputs always yield a deep-equal decision. No IO, no wall
 * clock (the clock is `constraints.now`), no randomness.
 */
export function decide(input: PolicyInput): PolicyDecision {
  const ctx = resolveContext(input);
  const cause: RootCause = ctx.classification.cause;
  const playbook = PLAYBOOKS[cause] ?? PLAYBOOKS.UNKNOWN;
  const intended = playbook.decide(ctx);
  return applyGuardrails(playbook, intended, ctx);
}

/** Narrow a full decision to the compact Phase 7 spec shape for downstream use. */
export interface RecoveryDecisionDto {
  action: RecoveryActions;
  cause: RootCause;
  reason: string;
  delayMinutes?: number;
  maxAttempts?: number;
  requiresCustomerMessage?: boolean;
  requiresHumanReview?: boolean;
}

export function toRecoveryDecision(d: PolicyDecision): RecoveryDecisionDto {
  return {
    action: d.action,
    cause: d.cause,
    reason: d.reason,
    ...(d.delayMinutes != null ? { delayMinutes: d.delayMinutes } : {}),
    maxAttempts: d.maxAttempts,
    requiresCustomerMessage: d.requiresCustomerMessage,
    requiresHumanReview: d.requiresHumanReview,
  };
}
