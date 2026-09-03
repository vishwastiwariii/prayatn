import {
  POLICY_ENGINE_VERSION,
  type PolicyInput,
  decide as evaluatePolicy,
} from '@recovery-desk/policy-engine';
import type {
  DecideRecoveryDeps,
  DecideRecoveryResult,
  DecisionContext,
  StoredAction,
} from './types';

/**
 * `POST /decide` core.
 *
 *   load(payment + failure + classification + history + customer)
 *     -> policy-engine.decide()   [pure, already-built playbooks]
 *     -> persist ONE RecoveryAction row (the approved action) + audit
 *
 * Idempotent on `decide:<classificationId>` — re-calling returns the same row.
 * This is the ONLY place a recovery action is authored; the worker later only
 * executes what this produced.
 */

export const DECISION_IDEMPOTENCY_PREFIX = 'decide';

function idempotencyKeyFor(classificationId: string): string {
  return `${DECISION_IDEMPOTENCY_PREFIX}:${classificationId}`;
}

function toPolicyInput(ctx: DecisionContext, now: Date): PolicyInput {
  const cls = ctx.classification;
  if (!cls) throw new Error('toPolicyInput requires a classification');
  return {
    payment: {
      id: ctx.payment.id,
      method: ctx.payment.method as PolicyInput['payment']['method'],
      status: ctx.payment.status as PolicyInput['payment']['status'],
      attemptCount: ctx.payment.attemptCount,
      amountMinor: ctx.payment.amountMinor,
      currency: ctx.payment.currency,
    },
    failure: {
      id: ctx.failure.id,
      reason: ctx.failure.reason,
      source: ctx.failure.source as PolicyInput['failure']['source'],
      step: ctx.failure.step as PolicyInput['failure']['step'],
      occurredAt: ctx.failure.occurredAt,
    },
    classification: {
      cause: cls.cause as PolicyInput['classification']['cause'],
      confidence: cls.confidence,
      ruleId: cls.ruleId,
    },
    customer: {
      salaryDay: ctx.customer.salaryDay,
      balanceState: ctx.customer.balanceState,
      preferredLanguage: ctx.customer.preferredLanguage,
    },
    history: {
      retriesExecuted: ctx.history.retriesExecuted,
      messagesSentInWindow: ctx.history.messagesSentInWindow,
      railSwitched: ctx.history.railSwitched,
      mandateRevoked: ctx.history.mandateRevoked,
    },
    constraints: { now },
  };
}

export async function decideRecovery(
  failureId: string,
  deps: DecideRecoveryDeps,
): Promise<DecideRecoveryResult> {
  const ctx = await deps.loadDecisionContext(failureId);
  if (!ctx) return { status: 'FAILURE_NOT_FOUND', failureId };
  if (!ctx.classification) return { status: 'NOT_CLASSIFIED', failureId };

  const idempotencyKey = idempotencyKeyFor(ctx.classification.id);

  const existing = await deps.findActionByKey(idempotencyKey);
  if (existing) return { status: 'DUPLICATE', duplicate: true, action: existing };

  const now = deps.now();
  const decision = evaluatePolicy(toPolicyInput(ctx, now));
  const attemptNumber = ctx.payment.attemptCount + 1;

  let action: StoredAction;
  try {
    action = await deps.persistDecision({ context: ctx, decision, idempotencyKey, attemptNumber });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await deps.findActionByKey(idempotencyKey);
      if (winner) return { status: 'DUPLICATE', duplicate: true, action: winner };
    }
    throw err;
  }

  return { status: 'DECIDED', duplicate: false, action, decision };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

export { POLICY_ENGINE_VERSION };
