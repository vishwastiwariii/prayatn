import {
  type PaymentStatus,
  Prisma,
  type RecoveryActionStatus,
  type RecoveryActionType,
  type RecoveryStatus,
  createRepositories,
  prismaClient,
  withTransaction,
} from '@recovery-desk/db';
import type { PolicyDecision } from '@recovery-desk/policy-engine';
import { createSimulator } from '@recovery-desk/simulator';
import { createRecoveryQueue, enqueueRecoveryJob } from './queue';
import { SCHEDULABLE_ACTIONS } from './types';
import type {
  DecideRecoveryDeps,
  DecisionContext,
  EnqueueRecoveryDeps,
  ExecuteRecoveryDeps,
  PersistDecisionArgs,
  PersistOutcomeArgs,
  StoredAction,
  StoredActionWithPayment,
} from './types';

const repos = createRepositories();

function toMinor(amount: { toString(): string }): number {
  return Math.round(Number(amount) * 100);
}
function minorToDecimalString(minor: number): string {
  return (minor / 100).toFixed(2);
}

function toStoredAction(row: {
  id: string;
  paymentId: string;
  cause: string;
  action: string;
  status: string;
  attemptNumber: number;
  scheduledFor: Date | null;
  reason: string | null;
  delayMinutes: number | null;
  maxAttempts: number | null;
  idempotencyKey: string;
  createdAt: Date;
  executedAt: Date | null;
}): StoredAction {
  return {
    id: row.id,
    paymentId: row.paymentId,
    cause: row.cause,
    action: row.action as StoredAction['action'],
    status: row.status,
    attemptNumber: row.attemptNumber,
    scheduledFor: row.scheduledFor,
    reason: row.reason,
    delayMinutes: row.delayMinutes,
    maxAttempts: row.maxAttempts,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    executedAt: row.executedAt,
  };
}

// --- decide -----------------------------------------------------------

/** Map a policy decision to the initial persisted RecoveryAction state. */
function initialActionState(decision: PolicyDecision): {
  status: RecoveryActionStatus;
  cancelOpen: boolean;
  paymentStatus?: PaymentStatus;
  paymentRecoveryStatus?: RecoveryStatus;
} {
  if (decision.action === 'HARD_STOP') {
    return {
      status: 'CANCELLED',
      cancelOpen: true,
      paymentStatus: 'HARD_STOPPED',
      paymentRecoveryStatus: 'HARD_STOPPED',
    };
  }
  if (decision.action === 'HUMAN_REVIEW') {
    return { status: 'BLOCKED', cancelOpen: false, paymentRecoveryStatus: 'HUMAN_REVIEW' };
  }
  if (SCHEDULABLE_ACTIONS.has(decision.action) && decision.permitted.autoExecute) {
    return { status: 'PENDING', cancelOpen: false };
  }
  return { status: 'BLOCKED', cancelOpen: false };
}

export const liveDecideDeps: DecideRecoveryDeps = {
  now: () => new Date(),

  async loadDecisionContext(failureId): Promise<DecisionContext | null> {
    const failure = await prismaClient.paymentFailure.findUnique({
      where: { id: failureId },
      include: { payment: { include: { customer: true } } },
    });
    if (!failure) return null;
    const payment = failure.payment;

    const classification = await repos.classifications.latestForFailure(failureId);

    const [executedActions, mandateHits] = await Promise.all([
      prismaClient.recoveryAction.findMany({
        where: { paymentId: payment.id, status: 'EXECUTED' },
        select: { action: true, executedAt: true },
      }),
      prismaClient.classification.count({
        where: { cause: 'MANDATE_INVALID', failure: { paymentId: payment.id } },
      }),
    ]);
    const dayAgo = Date.now() - 24 * 60 * 60_000;

    return {
      payment: {
        id: payment.id,
        method: payment.method,
        status: payment.status,
        recoveryStatus: payment.recoveryStatus,
        attemptCount: payment.attemptCount,
        amountMinor: toMinor(payment.amount),
        currency: payment.currency,
      },
      failure: {
        id: failure.id,
        reason: failure.errorReason,
        source: failure.errorSource,
        step: failure.errorStep,
        occurredAt: failure.occurredAt,
      },
      classification: classification
        ? {
            id: classification.id,
            cause: classification.cause,
            confidence: classification.confidence,
            ruleId: classification.ruleId,
          }
        : null,
      customer: {
        salaryDay: payment.customer.salaryDay,
        balanceState: payment.customer.balanceState,
        preferredLanguage: payment.customer.preferredLanguage,
      },
      history: {
        retriesExecuted: executedActions.filter((a) => a.action !== 'MESSAGE').length,
        messagesSentInWindow: executedActions.filter(
          (a) => a.action === 'MESSAGE' && (a.executedAt?.getTime() ?? 0) >= dayAgo,
        ).length,
        railSwitched: executedActions.some((a) => a.action === 'SWITCH_RAIL'),
        mandateRevoked: mandateHits > 0,
      },
    };
  },

  async findActionByKey(idempotencyKey) {
    const row = await repos.recoveryActions.findByIdempotencyKey(idempotencyKey);
    return row ? toStoredAction(row) : null;
  },

  persistDecision({ context, decision, idempotencyKey, attemptNumber }: PersistDecisionArgs) {
    const init = initialActionState(decision);
    return withTransaction(async (tx) => {
      const r = createRepositories(tx);

      const row = await r.recoveryActions.create({
        paymentId: context.payment.id,
        cause: decision.cause,
        action: decision.action as RecoveryActionType,
        status: init.status,
        attemptNumber,
        scheduledFor: decision.nextEligibleAt,
        reason: decision.reason,
        delayMinutes: decision.delayMinutes,
        maxAttempts: decision.maxAttempts,
        idempotencyKey,
      });

      if (init.cancelOpen) {
        await tx.recoveryAction.updateMany({
          where: {
            paymentId: context.payment.id,
            status: { in: ['PENDING', 'SCHEDULED'] },
            id: { not: row.id },
          },
          data: { status: 'CANCELLED' },
        });
      }
      if (init.paymentStatus || init.paymentRecoveryStatus) {
        await tx.payment.update({
          where: { id: context.payment.id },
          data: {
            ...(init.paymentStatus ? { status: init.paymentStatus } : {}),
            ...(init.paymentRecoveryStatus ? { recoveryStatus: init.paymentRecoveryStatus } : {}),
          },
        });
      }

      await r.auditEvents.append({
        paymentId: context.payment.id,
        eventType: 'POLICY_DECISION',
        whatWeSaw:
          `Classified failure ${context.failure.id} on payment ${context.payment.id}: ` +
          `cause ${decision.cause} (${Math.round((context.classification?.confidence ?? 0) * 100)}%).`,
        whatWeConcluded:
          `Playbook ${decision.playbookId} -> intended ${decision.intendedAction}; ` +
          `after guardrails the approved action is ${decision.action}` +
          (decision.blockedBy.length ? ` (blocked by: ${decision.blockedBy.join(', ')})` : '') +
          `.`,
        whatWasAllowed:
          `maxAttempts=${decision.maxAttempts}, attemptsRemaining=${decision.attemptsRemaining}, ` +
          `permitted=${JSON.stringify(decision.permitted)}.`,
        whatWeDid:
          `Persisted RecoveryAction ${row.id} as ${init.status}` +
          (decision.nextEligibleAt
            ? `, scheduledFor ${decision.nextEligibleAt.toISOString()}`
            : '') +
          (init.cancelOpen ? '; cancelled all other open actions for this payment' : '') +
          '.',
        whatHappened:
          init.status === 'PENDING'
            ? 'Awaiting enqueue.'
            : `Terminal at decision time (${decision.action}); nothing will be queued.`,
        metadata: {
          actionId: row.id,
          playbookId: decision.playbookId,
          intendedAction: decision.intendedAction,
          action: decision.action,
          delayMinutes: decision.delayMinutes,
          maxAttempts: decision.maxAttempts,
          blockedBy: decision.blockedBy,
          reason: decision.reason,
        },
      });

      return toStoredAction(row);
    });
  },
};

// --- enqueue --------------------------------------------------------

let sharedQueue: ReturnType<typeof createRecoveryQueue> | null = null;
export function getRecoveryQueue(redisUrl = process.env.REDIS_URL ?? '') {
  sharedQueue ??= createRecoveryQueue(redisUrl);
  return sharedQueue;
}
export async function closeRecoveryQueue(): Promise<void> {
  if (sharedQueue) {
    await sharedQueue.close();
    sharedQueue = null;
  }
}

export const liveEnqueueDeps: EnqueueRecoveryDeps = {
  now: () => new Date(),

  async loadAction(actionId): Promise<StoredActionWithPayment | null> {
    const row = await prismaClient.recoveryAction.findUnique({
      where: { id: actionId },
      include: { payment: { select: { id: true, status: true, recoveryStatus: true } } },
    });
    if (!row) return null;
    return { ...toStoredAction(row), payment: row.payment };
  },

  async enqueue(data, delayMs) {
    return enqueueRecoveryJob(getRecoveryQueue(), data, { delayMs });
  },

  markScheduled(actionId, jobId, delayMs) {
    return withTransaction(async (tx) => {
      const r = createRepositories(tx);
      const row = await r.recoveryActions.update(actionId, { status: 'SCHEDULED' });
      await tx.payment.update({
        where: { id: row.paymentId },
        data: { recoveryStatus: 'SCHEDULED' },
      });
      await r.auditEvents.append({
        paymentId: row.paymentId,
        eventType: 'RECOVERY_ENQUEUED',
        whatWeSaw: `Approved action ${actionId} (${row.action}) ready to schedule.`,
        whatWeConcluded: 'Action is PENDING and schedulable; hand it to the queue.',
        whatWasAllowed: 'Enqueue exactly one BullMQ job, keyed by the action id.',
        whatWeDid: `Enqueued job ${jobId} with delay ${delayMs}ms; action -> SCHEDULED.`,
        whatHappened: 'Job is in Redis; the recovery worker will pick it up when due.',
        metadata: { actionId, jobId, delayMs },
      });
      return toStoredAction(row);
    });
  },
};

// --- execute (worker core) ---------------------------------------

export const liveExecuteDeps: ExecuteRecoveryDeps = {
  now: () => new Date(),
  gateway: createSimulator(),

  async loadExecutionContext(actionId) {
    const row = await prismaClient.recoveryAction.findUnique({
      where: { id: actionId },
      include: { payment: true, outcome: { select: { id: true } } },
    });
    if (!row) return null;
    return {
      action: {
        id: row.id,
        paymentId: row.paymentId,
        cause: row.cause,
        action: row.action as StoredAction['action'],
        status: row.status,
        attemptNumber: row.attemptNumber,
        maxAttempts: row.maxAttempts,
        executedAt: row.executedAt,
      },
      payment: {
        id: row.payment.id,
        status: row.payment.status,
        recoveryStatus: row.payment.recoveryStatus,
        attemptCount: row.payment.attemptCount,
        amountMinor: toMinor(row.payment.amount),
        method: row.payment.method,
      },
      outcomeExists: row.outcome != null,
    };
  },

  persistOutcome(args: PersistOutcomeArgs) {
    return withTransaction(async (tx) => {
      const r = createRepositories(tx);

      const outcome = await r.recoveryOutcomes.create({
        actionId: args.actionId,
        status: args.outcome.status,
        amountRecovered: minorToDecimalString(args.outcome.amountRecoveredMinor),
        gatewayLatencyMs: args.outcome.gatewayLatencyMs,
        failureReason: args.outcome.failureReason,
      });

      await r.recoveryActions.update(args.actionId, {
        status: args.actionFinalStatus as RecoveryActionStatus,
        ...(args.markExecutedAt ? { executedAt: args.markExecutedAt } : {}),
      });

      const payment = await tx.payment.update({
        where: { id: args.paymentId },
        data: {
          ...(args.payment.status ? { status: args.payment.status as PaymentStatus } : {}),
          ...(args.payment.recoveryStatus
            ? { recoveryStatus: args.payment.recoveryStatus as RecoveryStatus }
            : {}),
          ...(args.payment.incrementAttemptCount ? { attemptCount: { increment: 1 } } : {}),
        },
      });

      const { metadata, ...auditRest } = args.audit;
      await r.auditEvents.append({
        paymentId: args.paymentId,
        ...auditRest,
        metadata: metadata as Prisma.InputJsonObject,
      });

      return {
        outcomeId: outcome.id,
        paymentStatus: payment.status,
        recoveryStatus: payment.recoveryStatus,
      };
    });
  },
};
