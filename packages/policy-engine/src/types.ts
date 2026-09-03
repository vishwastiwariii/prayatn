import type {
  FailureSource,
  FailureStep,
  PaymentMethod,
  PaymentStatus,
  RootCause,
} from '@recovery-desk/domain';

/** The six things the policy engine is allowed to decide to do. */
export type RecoveryAction =
  'RETRY' | 'WAIT' | 'SWITCH_RAIL' | 'MESSAGE' | 'HARD_STOP' | 'HUMAN_REVIEW';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

// ---------------------------------------------------------------------------
// Inputs — "Payment + Failure + Classification + Recovery History + Constraints"
// ---------------------------------------------------------------------------

export interface PolicyPayment {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /** Attempts already consumed, INCLUDING the original failed charge. */
  attemptCount: number;
  amountMinor?: number | null;
  currency?: string | null;
}

export interface PolicyFailure {
  id: string;
  reason: string;
  source: FailureSource;
  step: FailureStep;
  occurredAt: Date;
}

export interface PolicyClassification {
  cause: RootCause;
  confidence: number;
  ruleId?: string | null;
}

export interface PolicyCustomer {
  /** Day of month (1-28) the customer is usually paid. Drives the funds-low wait. */
  salaryDay?: number | null;
  balanceState?: string | null;
  preferredLanguage?: string | null;
}

export interface PriorRecoveryAction {
  action: RecoveryAction;
  status: string;
  createdAt: Date;
  executedAt?: Date | null;
}

export interface RecoveryHistory {
  /** Automated retries already executed for this payment. */
  retriesExecuted: number;
  /** Customer messages sent in the rolling 24h window ending at `constraints.now`. */
  messagesSentInWindow: number;
  lastMessageAt?: Date | null;
  lastAttemptAt?: Date | null;
  /** A rail switch (e.g. UPI collect -> intent) has already been offered. */
  railSwitched: boolean;
  /** Mandate kill-switch: the backing mandate has been revoked. */
  mandateRevoked: boolean;
  priorActions: PriorRecoveryAction[];
}

export interface SystemConstraints {
  /** Injected clock. The engine never reads the wall clock itself. */
  now: Date;
  killSwitchEngaged: boolean;
  circuitBreaker: CircuitBreakerState;
  maxAttempts: number;
  maxMessagesPerDay: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  issuerRetryDelayMinutes: number;
  gatewayRecheckMinutes: number;
  circuitCooldownMinutes: number;
  minClassificationConfidence: number;
  fundsLowFallbackDelayMinutes: number;
}

/** What a caller must supply; everything except `now` has a default. */
export interface PolicyInput {
  payment: PolicyPayment;
  failure: PolicyFailure;
  classification: PolicyClassification;
  customer?: PolicyCustomer;
  history?: Partial<RecoveryHistory>;
  constraints: Partial<SystemConstraints> & Pick<SystemConstraints, 'now'>;
}

/** Fully-resolved context handed to playbooks and guardrails. */
export interface PolicyContext {
  payment: PolicyPayment;
  failure: PolicyFailure;
  classification: PolicyClassification;
  customer: PolicyCustomer;
  history: RecoveryHistory;
  constraints: SystemConstraints;
}

// ---------------------------------------------------------------------------
// Playbook output (the "what should be done" half)
// ---------------------------------------------------------------------------

export interface IntendedDecision {
  action: RecoveryAction;
  delayMinutes: number | null;
  maxAttempts: number;
  reason: string;
  requiresCustomerMessage?: boolean;
  requiresHumanReview?: boolean;
  /** Playbook itself is a permanent stop (HARD_STOP / UNKNOWN human review). */
  terminal?: boolean;
  evidence?: string[];
}

export interface Playbook {
  id: string;
  cause: RootCause;
  summary: string;
  decide(ctx: PolicyContext): IntendedDecision;
}

// ---------------------------------------------------------------------------
// Final decision (the "what should be done" + "what is permitted" halves)
// ---------------------------------------------------------------------------

export interface PermissionSet {
  /** May the worker execute a payment retry right now. */
  retry: boolean;
  /** May a (possibly delayed) retry be scheduled at all. */
  scheduleRetry: boolean;
  switchRail: boolean;
  messageCustomer: boolean;
  /** May the worker act on this decision with no human sign-off. */
  autoExecute: boolean;
}

export interface PolicyDecision {
  cause: RootCause;
  playbookId: string;

  /** What the playbook proposed, before guardrails. */
  intendedAction: RecoveryAction;
  /** What the worker should actually carry out, after guardrails. */
  action: RecoveryAction;

  delayMinutes: number | null;
  /** `constraints.now + delay`, pushed out by guardrails (quiet hours, breaker). */
  nextEligibleAt: Date | null;

  maxAttempts: number;
  attemptsRemaining: number;

  /** No further automated recovery will ever run for this payment. */
  terminal: boolean;
  permitted: PermissionSet;
  /** Guardrail ids that made the outcome more restrictive than the playbook wanted. */
  blockedBy: string[];
  /** Every guardrail id that fired (superset of `blockedBy`). */
  constraintsApplied: string[];

  requiresCustomerMessage: boolean;
  requiresHumanReview: boolean;

  reason: string;
  evidence: string[];
}
