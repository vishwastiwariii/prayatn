import { classify } from '@recovery-desk/classifier';
import { type RecoveryHistory, decide } from '@recovery-desk/policy-engine';
import type { FailureDescriptor } from '@recovery-desk/simulator';
import type { Strategy } from './env';
import type { StrategyEnv } from './types';

/**
 * NAIVE BASELINE — Phase 11.
 *
 * On any failure: retry immediately. Three times. Stop. It never calls the
 * classifier or the policy engine. It is intentionally dumb; its only purpose
 * is to be a measurable comparison point.
 */
export const naiveStrategy: Strategy = (env: StrategyEnv) => {
  for (let i = 0; i < 3; i += 1) {
    if (env.retry(0).status === 'SUCCESS') return;
  }
  env.stop('EXHAUSTED');
};

/**
 * RECOVERY DESK — Phase 12.
 *
 * Uses the REAL Phase 6 classifier and Phase 7 policy engine on every pass.
 * It only sees `env.lastFailure()` (a provider-style descriptor) — never the
 * simulator's hidden state.
 */
export const recoveryDeskStrategy: Strategy = (env: StrategyEnv) => {
  const history: RecoveryHistory = {
    retriesExecuted: 0,
    messagesSentInWindow: 0,
    railSwitched: false,
    mandateRevoked: false,
    lastMessageAt: null,
    lastAttemptAt: null,
    priorActions: [],
  };

  const toClassifierInput = (f: FailureDescriptor) => ({
    errorCode: f.code,
    errorReason: f.reason,
    errorSource: f.source,
    errorStep: f.step,
    errorDescription: f.description,
    method: env.payment.method,
  });

  // Bounded loop: the policy engine's attempt ceiling ends it well before this.
  for (let pass = 0; pass < 8; pass += 1) {
    const failure = env.lastFailure();
    const classification = classify(toClassifierInput(failure));

    const decision = decide({
      payment: {
        id: env.payment.id,
        method: env.payment.method,
        status: 'FAILED',
        attemptCount: env.attemptsMade(),
        amountMinor: env.payment.amountMinor,
        currency: env.payment.currency,
      },
      failure: {
        id: `${env.payment.id}_failure`,
        reason: failure.reason,
        source: failure.source,
        step: failure.step,
        occurredAt: env.now(),
      },
      classification: {
        cause: classification.cause,
        confidence: classification.confidence,
        ruleId: classification.ruleId,
      },
      customer: { salaryDay: env.payment.salaryDay, balanceState: null, preferredLanguage: null },
      history,
      constraints: { now: env.now() },
    });

    switch (decision.action) {
      case 'HARD_STOP':
        env.stop('HARD_STOP');
        return;

      case 'HUMAN_REVIEW':
        env.stop(
          decision.blockedBy.includes('attempt_limit_reached') ? 'EXHAUSTED' : 'HUMAN_REVIEW',
        );
        return;

      case 'MESSAGE': {
        if (env.messagesSent() >= 2) {
          env.stop('MESSAGE_LIMIT');
          return;
        }
        env.message();
        history.messagesSentInWindow += 1;
        if (env.retry(60).status === 'SUCCESS') return;
        history.retriesExecuted += 1;
        break;
      }

      case 'SWITCH_RAIL': {
        env.switchRail();
        history.railSwitched = true;
        if (env.retry(decision.delayMinutes ?? 0).status === 'SUCCESS') return;
        history.retriesExecuted += 1;
        break;
      }

      case 'RETRY':
      case 'WAIT': {
        if (env.retry(decision.delayMinutes ?? 0).status === 'SUCCESS') return;
        history.retriesExecuted += 1;
        break;
      }
    }
  }
  env.stop('EXHAUSTED');
};
