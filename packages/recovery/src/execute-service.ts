import { InfrastructureError } from './queue';
import { SCHEDULABLE_ACTIONS } from './types';
import type {
  ExecuteRecoveryDeps,
  ExecuteRecoveryResult,
  ExecutionContext,
  OutcomeStatus,
  PersistOutcomeArgs,
} from './types';

/**
 * Recovery worker core — Phase 9.
 *
 *   load(action + payment)
 *     -> idempotency check          (already EXECUTED / outcome exists -> no-op)
 *     -> re-check safety            (status, payment state, attempt ceiling)
 *     -> execute via the mock gateway
 *     -> persist outcome + update payment + audit   (one transaction)
 *
 * THE RULE: this function executes an action that was ALREADY APPROVED by
 * `POST /decide`. It never runs the classifier or the policy engine, never
 * derives a delay, never changes `maxAttempts`. Its only judgement is a
 * conservative safety re-check right before execution (the queue message may be
 * stale). Anything it blocks it records as an outcome — it does not silently
 * skip.
 *
 * A gateway decline is NOT an error: it is recorded and the function returns
 * normally (the BullMQ job completes). Only genuine infrastructure faults throw
 * `InfrastructureError`, which is what BullMQ's retry policy is for.
 */

const NON_RECOVERABLE_PAYMENT_STATUSES = new Set(['SUCCEEDED', 'HARD_STOPPED']);

export async function executeRecoveryAction(
  actionId: string,
  deps: ExecuteRecoveryDeps,
): Promise<ExecuteRecoveryResult> {
  let ctx: ExecutionContext | null;
  try {
    ctx = await deps.loadExecutionContext(actionId);
  } catch (err) {
    throw new InfrastructureError(`failed to load execution context for ${actionId}`, err);
  }
  if (!ctx) return { status: 'ACTION_NOT_FOUND', actionId };

  const { action } = ctx;

  // --- idempotency -----------------------------------------------------
  if (action.status === 'EXECUTED' || ctx.outcomeExists) {
    return { status: 'DUPLICATE', actionId };
  }

  // --- safety re-check (verify the approved action, do NOT re-decide) --
  const block = safetyBlock(ctx);
  if (block) {
    const outcomeId = await persistBlocked(deps, ctx, block);
    return { status: 'BLOCKED', note: block.note, outcomeId };
  }

  // --- execute against the mock gateway ------------------------------
  const now = deps.now();
  if (action.action === 'MESSAGE') {
    return runMessage(deps, ctx, now);
  }
  return runCharge(deps, ctx, now);
}

interface Block {
  note: string;
  outcomeStatus: OutcomeStatus;
  reason: string;
  actionFinalStatus: string;
  paymentStatus?: string;
  recoveryStatus?: string;
}

function safetyBlock(ctx: ExecutionContext): Block | null {
  const { action, payment } = ctx;

  if (['CANCELLED', 'BLOCKED', 'FAILED'].includes(action.status)) {
    return {
      note: `action_${action.status.toLowerCase()}`,
      outcomeStatus: action.status === 'CANCELLED' ? 'CANCELLED' : 'BLOCKED',
      reason: `Action is ${action.status}; not executing.`,
      actionFinalStatus: action.status,
    };
  }

  if (!SCHEDULABLE_ACTIONS.has(action.action)) {
    return {
      note: 'non_executable_action',
      outcomeStatus: 'BLOCKED',
      reason: `Action ${action.action} is terminal and is never executed by the worker.`,
      actionFinalStatus: 'BLOCKED',
    };
  }

  if (NON_RECOVERABLE_PAYMENT_STATUSES.has(payment.status)) {
    return {
      note: payment.status === 'SUCCEEDED' ? 'already_recovered' : 'payment_hard_stopped',
      outcomeStatus: 'CANCELLED',
      reason: `Payment is already ${payment.status}; nothing to recover.`,
      actionFinalStatus: 'CANCELLED',
    };
  }

  if (action.maxAttempts != null && payment.attemptCount >= action.maxAttempts) {
    return {
      note: 'attempt_limit_reached',
      outcomeStatus: 'BLOCKED',
      reason: `Attempt limit reached (${payment.attemptCount}/${action.maxAttempts}); not executing.`,
      actionFinalStatus: 'BLOCKED',
      paymentStatus: 'EXHAUSTED',
      recoveryStatus: 'EXHAUSTED',
    };
  }

  return null;
}

async function persistBlocked(
  deps: ExecuteRecoveryDeps,
  ctx: ExecutionContext,
  block: Block,
): Promise<string> {
  const args: PersistOutcomeArgs = {
    actionId: ctx.action.id,
    paymentId: ctx.payment.id,
    outcome: {
      status: block.outcomeStatus,
      amountRecoveredMinor: 0,
      gatewayLatencyMs: null,
      failureReason: block.reason,
    },
    actionFinalStatus: block.actionFinalStatus,
    markExecutedAt: null,
    payment: {
      ...(block.paymentStatus ? { status: block.paymentStatus } : {}),
      ...(block.recoveryStatus ? { recoveryStatus: block.recoveryStatus } : {}),
      incrementAttemptCount: false,
    },
    audit: {
      eventType: 'RECOVERY_BLOCKED',
      whatWeSaw: `Job for approved action ${ctx.action.id} (${ctx.action.action}, cause ${ctx.action.cause}).`,
      whatWeConcluded: `Pre-execution safety re-check failed: ${block.note}.`,
      whatWasAllowed: 'Execute the approved action only if every safety condition still holds.',
      whatWeDid: `Did not execute. ${block.reason}`,
      whatHappened: `Recorded a ${block.outcomeStatus} outcome; no charge was attempted.`,
      metadata: { actionId: ctx.action.id, block: block.note },
    },
  };
  const { outcomeId } = await guardInfra(
    () => deps.persistOutcome(args),
    'persist blocked outcome',
  );
  return outcomeId;
}

async function runMessage(
  deps: ExecuteRecoveryDeps,
  ctx: ExecutionContext,
  now: Date,
): Promise<ExecuteRecoveryResult> {
  const sent = guardSync(
    () =>
      deps.gateway.sendMessage({
        paymentId: ctx.payment.id,
        cause: ctx.action.cause,
        channel: 'SMS',
      }),
    'gateway.sendMessage',
  );

  const args: PersistOutcomeArgs = {
    actionId: ctx.action.id,
    paymentId: ctx.payment.id,
    outcome: {
      status: 'SUCCESS',
      amountRecoveredMinor: 0,
      gatewayLatencyMs: sent.latencyMs,
      failureReason: null,
    },
    actionFinalStatus: 'EXECUTED',
    markExecutedAt: now,
    payment: { incrementAttemptCount: false },
    audit: {
      eventType: 'RECOVERY_EXECUTED',
      whatWeSaw: `Approved action ${ctx.action.id}: MESSAGE the customer (cause ${ctx.action.cause}).`,
      whatWeConcluded: 'Safety re-check passed. A customer nudge is the approved action.',
      whatWasAllowed: 'Send exactly one message; do not attempt a charge.',
      whatWeDid: `Sent message ${sent.messageId} via SMS (gateway ${sent.latencyMs}ms).`,
      whatHappened: 'Message dispatched. Awaiting customer action; payment state unchanged.',
      metadata: { actionId: ctx.action.id, messageId: sent.messageId },
    },
  };
  const res = await guardInfra(() => deps.persistOutcome(args), 'persist message outcome');
  return {
    status: 'EXECUTED_SUCCESS',
    outcomeId: res.outcomeId,
    paymentStatus: res.paymentStatus,
    recoveryStatus: res.recoveryStatus,
    gatewayLatencyMs: sent.latencyMs,
  };
}

async function runCharge(
  deps: ExecuteRecoveryDeps,
  ctx: ExecutionContext,
  now: Date,
): Promise<ExecuteRecoveryResult> {
  const attemptNumber = ctx.payment.attemptCount + 1;
  const result = guardSync(
    () =>
      deps.gateway.charge({
        paymentId: ctx.payment.id,
        amountMinor: ctx.payment.amountMinor,
        method: ctx.payment.method,
        attemptNumber,
      }),
    'gateway.charge',
  );

  const success = result.status === 'SUCCESS';
  const newAttemptCount = ctx.payment.attemptCount + 1;
  const exhausted =
    !success && ctx.action.maxAttempts != null && newAttemptCount >= ctx.action.maxAttempts;

  const args: PersistOutcomeArgs = {
    actionId: ctx.action.id,
    paymentId: ctx.payment.id,
    outcome: {
      status: success ? 'SUCCESS' : 'FAILED',
      amountRecoveredMinor: success ? result.amountCapturedMinor : 0,
      gatewayLatencyMs: result.latencyMs,
      failureReason: success ? null : `${result.code}: ${result.reason}`,
    },
    actionFinalStatus: 'EXECUTED',
    markExecutedAt: now,
    payment: {
      status: success ? 'SUCCEEDED' : exhausted ? 'EXHAUSTED' : 'RECOVERING',
      recoveryStatus: success ? 'RECOVERED' : exhausted ? 'EXHAUSTED' : 'RETRYING',
      incrementAttemptCount: true,
    },
    audit: {
      eventType: 'RECOVERY_EXECUTED',
      whatWeSaw: `Approved action ${ctx.action.id}: ${ctx.action.action} on payment ${ctx.payment.id} (attempt ${attemptNumber}).`,
      whatWeConcluded: 'Safety re-check passed; executing the pre-approved charge.',
      whatWasAllowed: `One charge attempt, ceiling ${ctx.action.maxAttempts ?? 'n/a'} attempts total.`,
      whatWeDid: `Charged via the gateway: ${result.code} in ${result.latencyMs}ms.`,
      whatHappened: success
        ? `Payment SUCCEEDED; ${result.amountCapturedMinor} minor units recovered.`
        : `Charge failed (${result.reason}); payment -> ${exhausted ? 'EXHAUSTED' : 'RECOVERING'}.`,
      metadata: {
        actionId: ctx.action.id,
        attemptNumber,
        gatewayCode: result.code,
        gatewayLatencyMs: result.latencyMs,
        exhausted,
      },
    },
  };

  const res = await guardInfra(() => deps.persistOutcome(args), 'persist charge outcome');
  return {
    status: success ? 'EXECUTED_SUCCESS' : 'EXECUTED_FAILURE',
    outcomeId: res.outcomeId,
    paymentStatus: res.paymentStatus,
    recoveryStatus: res.recoveryStatus,
    gatewayLatencyMs: result.latencyMs,
  };
}

// --- infra-fault guards -------------------------------------------------

async function guardInfra<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InfrastructureError) throw err;
    throw new InfrastructureError(`infrastructure fault while trying to ${what}`, err);
  }
}

function guardSync<T>(fn: () => T, what: string): T {
  try {
    return fn();
  } catch (err) {
    throw new InfrastructureError(`infrastructure fault while trying to ${what}`, err);
  }
}
