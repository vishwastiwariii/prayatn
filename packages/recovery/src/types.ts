import type { PolicyDecision, RecoveryAction as PolicyAction } from '@recovery-desk/policy-engine';

/** RecoveryAction row shape the services pass around (DB-agnostic). */
export interface StoredAction {
  id: string;
  paymentId: string;
  cause: string;
  action: PolicyAction;
  status: string; // RecoveryActionStatus
  attemptNumber: number;
  scheduledFor: Date | null;
  reason: string | null;
  delayMinutes: number | null;
  maxAttempts: number | null;
  idempotencyKey: string;
  createdAt: Date;
  executedAt: Date | null;
}

export const SCHEDULABLE_ACTIONS: ReadonlySet<PolicyAction> = new Set<PolicyAction>([
  'RETRY',
  'WAIT',
  'SWITCH_RAIL',
  'MESSAGE',
]);

// ---------------------------------------------------------------------------
// decide-service
// ---------------------------------------------------------------------------

export interface DecisionContext {
  payment: {
    id: string;
    method: string;
    status: string;
    recoveryStatus: string | null;
    attemptCount: number;
    amountMinor: number;
    currency: string;
  };
  failure: {
    id: string;
    reason: string;
    source: string;
    step: string;
    occurredAt: Date;
  };
  classification: {
    id: string;
    cause: string;
    confidence: number;
    ruleId: string | null;
  } | null;
  customer: {
    salaryDay: number | null;
    balanceState: string | null;
    preferredLanguage: string | null;
  };
  history: {
    retriesExecuted: number;
    messagesSentInWindow: number;
    railSwitched: boolean;
    mandateRevoked: boolean;
  };
}

export interface PersistDecisionArgs {
  context: DecisionContext;
  decision: PolicyDecision;
  idempotencyKey: string;
  attemptNumber: number;
}

export interface DecideRecoveryDeps {
  loadDecisionContext(failureId: string): Promise<DecisionContext | null>;
  findActionByKey(idempotencyKey: string): Promise<StoredAction | null>;
  persistDecision(args: PersistDecisionArgs): Promise<StoredAction>;
  now(): Date;
}

export type DecideRecoveryResult =
  | { status: 'DECIDED'; duplicate: false; action: StoredAction; decision: PolicyDecision }
  | { status: 'DUPLICATE'; duplicate: true; action: StoredAction }
  | { status: 'FAILURE_NOT_FOUND'; failureId: string }
  | { status: 'NOT_CLASSIFIED'; failureId: string };

// ---------------------------------------------------------------------------
// enqueue-service
// ---------------------------------------------------------------------------

export interface StoredActionWithPayment extends StoredAction {
  payment: { id: string; status: string; recoveryStatus: string | null };
}

export interface EnqueueRecoveryDeps {
  loadAction(actionId: string): Promise<StoredActionWithPayment | null>;
  enqueue(
    data: { actionId: string; paymentId: string; attemptNumber: number; enqueuedAt: string },
    delayMs: number,
  ): Promise<{ jobId: string; delayMs: number }>;
  markScheduled(actionId: string, jobId: string, delayMs: number): Promise<StoredAction>;
  now(): Date;
}

export type EnqueueRecoveryResult =
  | {
      status: 'ENQUEUED';
      jobId: string;
      delayMs: number;
      scheduledFor: Date | null;
      action: StoredAction;
    }
  | { status: 'DUPLICATE'; jobId: string; action: StoredActionWithPayment }
  | { status: 'NOT_FOUND'; actionId: string }
  | {
      status: 'NOT_ENQUEUEABLE';
      actionId: string;
      reason: string;
      action: StoredActionWithPayment;
    };

// ---------------------------------------------------------------------------
// execute-service (worker core)
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  action: {
    id: string;
    paymentId: string;
    cause: string;
    action: PolicyAction;
    status: string;
    attemptNumber: number;
    maxAttempts: number | null;
    executedAt: Date | null;
  };
  payment: {
    id: string;
    status: string;
    recoveryStatus: string | null;
    attemptCount: number;
    amountMinor: number;
    method: string;
  };
  outcomeExists: boolean;
}

export type OutcomeStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'DUPLICATE';

export interface PersistOutcomeArgs {
  actionId: string;
  paymentId: string;
  outcome: {
    status: OutcomeStatus;
    amountRecoveredMinor: number;
    gatewayLatencyMs: number | null;
    failureReason: string | null;
  };
  actionFinalStatus: string; // RecoveryActionStatus
  markExecutedAt: Date | null;
  payment: {
    status?: string;
    recoveryStatus?: string;
    incrementAttemptCount: boolean;
  };
  audit: {
    eventType: string;
    whatWeSaw: string;
    whatWeConcluded: string;
    whatWasAllowed: string;
    whatWeDid: string;
    whatHappened: string;
    metadata: Record<string, unknown>;
  };
}

export interface ExecuteRecoveryDeps {
  loadExecutionContext(actionId: string): Promise<ExecutionContext | null>;
  gateway: import('@recovery-desk/simulator').Gateway;
  persistOutcome(
    args: PersistOutcomeArgs,
  ): Promise<{ outcomeId: string; paymentStatus: string; recoveryStatus: string | null }>;
  now(): Date;
}

export type ExecuteRecoveryResult =
  | {
      status: 'EXECUTED_SUCCESS' | 'EXECUTED_FAILURE';
      outcomeId: string;
      paymentStatus: string;
      recoveryStatus: string | null;
      gatewayLatencyMs: number;
    }
  | { status: 'BLOCKED'; note: string; outcomeId: string }
  | { status: 'DUPLICATE'; actionId: string }
  | { status: 'ACTION_NOT_FOUND'; actionId: string };
