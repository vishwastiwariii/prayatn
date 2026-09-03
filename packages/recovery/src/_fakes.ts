/* In-memory test doubles (not a spec file). A single `World` backs fake
 * implementations of the decide / enqueue / execute dep interfaces, mirroring
 * the transactional semantics of live-deps.ts without a database. */
import type {
  DecideRecoveryDeps,
  DecisionContext,
  EnqueueRecoveryDeps,
  ExecuteRecoveryDeps,
  StoredAction,
} from './types';
import type { Gateway } from '@recovery-desk/simulator';

let seq = 0;
const id = (p: string) => `${p}_${(seq += 1)}`;

export interface PaymentRow {
  id: string;
  method: string;
  status: string;
  recoveryStatus: string | null;
  attemptCount: number;
  amountMinor: number;
  currency: string;
  salaryDay: number | null;
  balanceState: string | null;
  preferredLanguage: string | null;
}
export interface FailureRow {
  id: string;
  paymentId: string;
  reason: string;
  source: string;
  step: string;
  occurredAt: Date;
}
export interface ClassificationRow {
  id: string;
  failureId: string;
  cause: string;
  confidence: number;
  ruleId: string | null;
}
export type ActionRow = StoredAction;
export interface OutcomeRow {
  id: string;
  actionId: string;
  status: string;
  amountRecoveredMinor: number;
  gatewayLatencyMs: number | null;
  failureReason: string | null;
}
export interface AuditRow {
  paymentId: string;
  eventType: string;
  whatWeSaw: string;
  whatWeConcluded: string;
  whatWasAllowed: string;
  whatWeDid: string;
  whatHappened: string;
  metadata: Record<string, unknown>;
}

export interface World {
  payments: Map<string, PaymentRow>;
  failures: Map<string, FailureRow>;
  classifications: Map<string, ClassificationRow>;
  actions: Map<string, ActionRow>;
  outcomes: Map<string, OutcomeRow>;
  audits: AuditRow[];
}

export function makeWorld(): World {
  return {
    payments: new Map(),
    failures: new Map(),
    classifications: new Map(),
    actions: new Map(),
    outcomes: new Map(),
    audits: [],
  };
}

/** Seed a payment + failure (+ optional classification) and return their ids. */
export function seedFailure(
  world: World,
  opts: {
    payment?: Partial<PaymentRow>;
    failure?: Partial<FailureRow>;
    classification?: Partial<ClassificationRow> | null;
  } = {},
): { paymentId: string; failureId: string; classificationId: string | null } {
  const paymentId = opts.payment?.id ?? id('pay');
  const payment: PaymentRow = {
    id: paymentId,
    method: 'CARD',
    status: 'FAILED',
    recoveryStatus: 'CLASSIFIED',
    attemptCount: 1,
    amountMinor: 250000,
    currency: 'INR',
    salaryDay: 1,
    balanceState: 'LOW',
    preferredLanguage: 'EN',
    ...opts.payment,
  };
  world.payments.set(paymentId, payment);

  const failureId = opts.failure?.id ?? id('fail');
  world.failures.set(failureId, {
    id: failureId,
    paymentId,
    reason: 'issuer_timeout',
    source: 'BANK',
    step: 'AUTHORIZATION',
    occurredAt: new Date('2026-09-10T11:59:00Z'),
    ...opts.failure,
  });

  let classificationId: string | null = null;
  if (opts.classification !== null) {
    classificationId = opts.classification?.id ?? id('cls');
    world.classifications.set(classificationId, {
      id: classificationId,
      failureId,
      cause: 'ISSUER_TEMPORARY_FAILURE',
      confidence: 0.94,
      ruleId: 'ISSUER_TEMP_001',
      ...opts.classification,
    });
  }
  return { paymentId, failureId, classificationId };
}

const FIXED_NOW = new Date('2026-09-10T12:00:00Z');

export function decideDepsFor(world: World, now: () => Date = () => FIXED_NOW): DecideRecoveryDeps {
  return {
    now,
    async loadDecisionContext(failureId): Promise<DecisionContext | null> {
      const failure = world.failures.get(failureId);
      if (!failure) return null;
      const payment = world.payments.get(failure.paymentId);
      if (!payment) return null;
      const classification =
        [...world.classifications.values()].find((c) => c.failureId === failureId) ?? null;
      return {
        payment: {
          id: payment.id,
          method: payment.method,
          status: payment.status,
          recoveryStatus: payment.recoveryStatus,
          attemptCount: payment.attemptCount,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
        failure: {
          id: failure.id,
          reason: failure.reason,
          source: failure.source,
          step: failure.step,
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
          salaryDay: payment.salaryDay,
          balanceState: payment.balanceState,
          preferredLanguage: payment.preferredLanguage,
        },
        history: {
          retriesExecuted: [...world.actions.values()].filter(
            (a) => a.paymentId === payment.id && a.status === 'EXECUTED' && a.action !== 'MESSAGE',
          ).length,
          messagesSentInWindow: 0,
          railSwitched: false,
          mandateRevoked: false,
        },
      };
    },
    async findActionByKey(key) {
      return [...world.actions.values()].find((a) => a.idempotencyKey === key) ?? null;
    },
    async persistDecision({ context, decision, idempotencyKey, attemptNumber }) {
      if ([...world.actions.values()].some((a) => a.idempotencyKey === idempotencyKey)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const status =
        decision.action === 'HARD_STOP'
          ? 'CANCELLED'
          : decision.action === 'HUMAN_REVIEW'
            ? 'BLOCKED'
            : decision.permitted.autoExecute
              ? 'PENDING'
              : 'BLOCKED';
      const row: ActionRow = {
        id: id('act'),
        paymentId: context.payment.id,
        cause: decision.cause,
        action: decision.action,
        status,
        attemptNumber,
        scheduledFor: decision.nextEligibleAt,
        reason: decision.reason,
        delayMinutes: decision.delayMinutes,
        maxAttempts: decision.maxAttempts,
        idempotencyKey,
        createdAt: now(),
        executedAt: null,
      };
      world.actions.set(row.id, row);
      if (decision.action === 'HARD_STOP') {
        for (const a of world.actions.values()) {
          if (
            a.paymentId === row.paymentId &&
            a.id !== row.id &&
            ['PENDING', 'SCHEDULED'].includes(a.status)
          ) {
            a.status = 'CANCELLED';
          }
        }
        const p = world.payments.get(row.paymentId);
        if (p) {
          p.status = 'HARD_STOPPED';
          p.recoveryStatus = 'HARD_STOPPED';
        }
      }
      world.audits.push({
        paymentId: row.paymentId,
        eventType: 'POLICY_DECISION',
        whatWeSaw: `cause ${decision.cause}`,
        whatWeConcluded: `${decision.playbookId} -> ${decision.action}`,
        whatWasAllowed: `maxAttempts=${decision.maxAttempts}`,
        whatWeDid: `persisted action ${row.id} as ${status}`,
        whatHappened: status === 'PENDING' ? 'awaiting enqueue' : 'terminal',
        metadata: { actionId: row.id, blockedBy: decision.blockedBy },
      });
      return row;
    },
  };
}

export function enqueueDepsFor(
  world: World,
  opts: { now?: () => Date; onEnqueue?: (data: unknown, delayMs: number) => void } = {},
): EnqueueRecoveryDeps {
  const now = opts.now ?? (() => FIXED_NOW);
  return {
    now,
    async loadAction(actionId) {
      const a = world.actions.get(actionId);
      if (!a) return null;
      const p = world.payments.get(a.paymentId);
      return {
        ...a,
        payment: {
          id: a.paymentId,
          status: p?.status ?? 'FAILED',
          recoveryStatus: p?.recoveryStatus ?? null,
        },
      };
    },
    async enqueue(data, delayMs) {
      opts.onEnqueue?.(data, delayMs);
      return { jobId: data.actionId, delayMs };
    },
    async markScheduled(actionId) {
      const a = world.actions.get(actionId);
      if (!a) throw new Error('missing action');
      a.status = 'SCHEDULED';
      const p = world.payments.get(a.paymentId);
      if (p) p.recoveryStatus = 'SCHEDULED';
      world.audits.push({
        paymentId: a.paymentId,
        eventType: 'RECOVERY_ENQUEUED',
        whatWeSaw: `action ${actionId} ready`,
        whatWeConcluded: 'schedulable',
        whatWasAllowed: 'one job',
        whatWeDid: `enqueued ${actionId}`,
        whatHappened: 'in redis',
        metadata: { actionId },
      });
      return a;
    },
  };
}

export function executeDepsFor(
  world: World,
  gateway: Gateway,
  now: () => Date = () => FIXED_NOW,
): ExecuteRecoveryDeps {
  return {
    now,
    gateway,
    async loadExecutionContext(actionId) {
      const a = world.actions.get(actionId);
      if (!a) return null;
      const p = world.payments.get(a.paymentId);
      if (!p) return null;
      return {
        action: {
          id: a.id,
          paymentId: a.paymentId,
          cause: a.cause,
          action: a.action,
          status: a.status,
          attemptNumber: a.attemptNumber,
          maxAttempts: a.maxAttempts,
          executedAt: a.executedAt,
        },
        payment: {
          id: p.id,
          status: p.status,
          recoveryStatus: p.recoveryStatus,
          attemptCount: p.attemptCount,
          amountMinor: p.amountMinor,
          method: p.method,
        },
        outcomeExists: [...world.outcomes.values()].some((o) => o.actionId === actionId),
      };
    },
    async persistOutcome(args) {
      const outcome: OutcomeRow = {
        id: id('out'),
        actionId: args.actionId,
        status: args.outcome.status,
        amountRecoveredMinor: args.outcome.amountRecoveredMinor,
        gatewayLatencyMs: args.outcome.gatewayLatencyMs,
        failureReason: args.outcome.failureReason,
      };
      world.outcomes.set(outcome.id, outcome);

      const a = world.actions.get(args.actionId);
      if (a) {
        a.status = args.actionFinalStatus;
        if (args.markExecutedAt) a.executedAt = args.markExecutedAt;
      }
      const p = world.payments.get(args.paymentId);
      if (p) {
        if (args.payment.status) p.status = args.payment.status;
        if (args.payment.recoveryStatus) p.recoveryStatus = args.payment.recoveryStatus;
        if (args.payment.incrementAttemptCount) p.attemptCount += 1;
      }
      world.audits.push({ paymentId: args.paymentId, ...args.audit });
      return {
        outcomeId: outcome.id,
        paymentStatus: p?.status ?? 'UNKNOWN',
        recoveryStatus: p?.recoveryStatus ?? null,
      };
    },
  };
}
