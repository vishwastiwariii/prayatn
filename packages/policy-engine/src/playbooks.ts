import type { RootCause } from '@recovery-desk/domain';
import { CAUSE_MAX_ATTEMPTS } from './constants';
import { minutesUntilSalaryWindow } from './time';
import type { IntendedDecision, Playbook } from './types';

/**
 * The Phase 7 playbooks — one per root cause.
 *
 * A playbook answers ONLY "what kind of action does this cause call for, and
 * with what timing / ceiling". It does not check attempt limits, quiet hours,
 * the circuit breaker or the kill switch — those are guardrails (guardrails.ts)
 * applied on top of every playbook uniformly.
 *
 * Mapping to the Phase 7 spec:
 *   CUSTOMER_FUNDS_LOW        -> WAIT for the salary window
 *   ISSUER_TEMPORARY_FAILURE  -> RETRY after 18 min
 *   GATEWAY_FAILURE           -> WAIT, timing follows the circuit breaker
 *   CUSTOMER_ABANDONMENT      -> MESSAGE (card 3DS) / SWITCH_RAIL (UPI collect)
 *   CUSTOMER_AUTH_FAILURE     -> MESSAGE (ask the customer to re-authenticate)
 *   PAYMENT_METHOD_INVALID    -> HARD_STOP
 *   MANDATE_INVALID           -> HARD_STOP, cancel all future retries
 *   UNKNOWN                   -> HUMAN_REVIEW, never auto-retry
 */

function max(cause: RootCause): number {
  return CAUSE_MAX_ATTEMPTS[cause];
}

const customerFundsLow: Playbook = {
  id: 'PB_FUNDS_LOW_v1',
  cause: 'CUSTOMER_FUNDS_LOW',
  summary: 'Wait for the customer’s expected salary credit, then retry once inside that window.',
  decide(ctx): IntendedDecision {
    const { delayMinutes, situation } = minutesUntilSalaryWindow(
      ctx.constraints.now,
      ctx.customer.salaryDay,
      ctx.constraints.fundsLowFallbackDelayMinutes,
    );
    const salaryDay = ctx.customer.salaryDay ?? 'unknown';
    return {
      action: 'WAIT',
      delayMinutes,
      maxAttempts: max('CUSTOMER_FUNDS_LOW'),
      reason:
        `Account had insufficient funds. Hold the retry for ~${delayMinutes} min ` +
        `(salary day = ${salaryDay}, ${situation}) so the balance can recover before we try again.`,
      evidence: [
        'cause=CUSTOMER_FUNDS_LOW',
        `salary_day=${salaryDay}`,
        `salary_window=${situation}`,
        `wait_minutes=${delayMinutes}`,
      ],
    };
  },
};

const issuerTemporaryFailure: Playbook = {
  id: 'PB_ISSUER_TEMPORARY_v1',
  cause: 'ISSUER_TEMPORARY_FAILURE',
  summary: 'Transient issuer problem — retry once after a short fixed cooldown.',
  decide(ctx): IntendedDecision {
    const delay = ctx.constraints.issuerRetryDelayMinutes;
    return {
      action: 'RETRY',
      delayMinutes: delay,
      maxAttempts: max('ISSUER_TEMPORARY_FAILURE'),
      reason: `Issuer failed temporarily. Retry after a ${delay}-minute cooldown to let the issuer recover.`,
      evidence: ['cause=ISSUER_TEMPORARY_FAILURE', `retry_delay_min=${delay}`],
    };
  },
};

const gatewayFailure: Playbook = {
  id: 'PB_GATEWAY_FAILURE_v1',
  cause: 'GATEWAY_FAILURE',
  summary: 'Gateway/aggregator problem — wait; timing tracks the circuit breaker.',
  decide(ctx): IntendedDecision {
    const breaker = ctx.constraints.circuitBreaker;
    const delay =
      breaker === 'OPEN'
        ? ctx.constraints.circuitCooldownMinutes
        : ctx.constraints.gatewayRecheckMinutes;
    return {
      action: 'WAIT',
      delayMinutes: delay,
      maxAttempts: max('GATEWAY_FAILURE'),
      reason:
        `Gateway-side failure. Circuit breaker is ${breaker}; wait ${delay} min before re-checking ` +
        `so we do not hammer a degraded gateway.`,
      evidence: ['cause=GATEWAY_FAILURE', `circuit_breaker=${breaker}`, `wait_minutes=${delay}`],
    };
  },
};

const customerAbandonment: Playbook = {
  id: 'PB_ABANDONMENT_v1',
  cause: 'CUSTOMER_ABANDONMENT',
  summary:
    'Customer started but never finished. On UPI, offer a different rail; elsewhere, nudge them to complete authentication.',
  decide(ctx): IntendedDecision {
    const maxAttempts = max('CUSTOMER_ABANDONMENT');
    if (ctx.payment.method === 'UPI') {
      return {
        action: ctx.history.railSwitched ? 'MESSAGE' : 'SWITCH_RAIL',
        delayMinutes: 0,
        maxAttempts,
        requiresCustomerMessage: true,
        reason: ctx.history.railSwitched
          ? 'UPI collect was abandoned again after a rail switch. Message the customer to complete the payment.'
          : 'UPI collect request was abandoned/expired. Offer an alternate UPI flow (intent/QR) instead of collect.',
        evidence: [
          'cause=CUSTOMER_ABANDONMENT',
          'method=UPI',
          `rail_already_switched=${ctx.history.railSwitched}`,
        ],
      };
    }
    return {
      action: 'MESSAGE',
      delayMinutes: 0,
      maxAttempts,
      requiresCustomerMessage: true,
      reason:
        'Customer did not complete authentication (3-D Secure page left to expire). ' +
        'Prompt them to retry the payment and finish authentication.',
      evidence: [
        'cause=CUSTOMER_ABANDONMENT',
        `method=${ctx.payment.method}`,
        'step=AUTHENTICATION',
      ],
    };
  },
};

const customerAuthFailure: Playbook = {
  id: 'PB_AUTH_FAILURE_v1',
  cause: 'CUSTOMER_AUTH_FAILURE',
  summary:
    'Authentication was tried and rejected — a blind retry just fails again; ask the customer.',
  decide(ctx): IntendedDecision {
    return {
      action: 'MESSAGE',
      delayMinutes: 0,
      maxAttempts: max('CUSTOMER_AUTH_FAILURE'),
      requiresCustomerMessage: true,
      reason:
        'Authentication was attempted and failed (e.g. wrong OTP / 3-D Secure declined). ' +
        'Message the customer to retry and authenticate carefully; do not auto-retry.',
      evidence: ['cause=CUSTOMER_AUTH_FAILURE', `method=${ctx.payment.method}`],
    };
  },
};

const paymentMethodInvalid: Playbook = {
  id: 'PB_METHOD_INVALID_v1',
  cause: 'PAYMENT_METHOD_INVALID',
  summary: 'The instrument itself cannot work (expired/invalid card) — stop.',
  decide(): IntendedDecision {
    return {
      action: 'HARD_STOP',
      delayMinutes: null,
      maxAttempts: max('PAYMENT_METHOD_INVALID'),
      terminal: true,
      reason:
        'Payment instrument is permanently unusable (expired or invalid card). No retry can succeed. ' +
        'Stop automated recovery; a new instrument is required from the customer.',
      evidence: ['cause=PAYMENT_METHOD_INVALID', 'structural_terminal'],
    };
  },
};

const mandateInvalid: Playbook = {
  id: 'PB_MANDATE_INVALID_v1',
  cause: 'MANDATE_INVALID',
  summary: 'The mandate backing this payment is gone — stop and cancel everything queued.',
  decide(): IntendedDecision {
    return {
      action: 'HARD_STOP',
      delayMinutes: null,
      maxAttempts: max('MANDATE_INVALID'),
      terminal: true,
      reason:
        'Mandate has been revoked/cancelled. Hard stop: cancel every scheduled and future retry for this payment.',
      evidence: ['cause=MANDATE_INVALID', 'structural_terminal', 'cancel_future_retries'],
    };
  },
};

const unknown: Playbook = {
  id: 'PB_UNKNOWN_v1',
  cause: 'UNKNOWN',
  summary: 'Root cause not identified — a human decides; never auto-retry.',
  decide(): IntendedDecision {
    return {
      action: 'HUMAN_REVIEW',
      delayMinutes: null,
      maxAttempts: max('UNKNOWN'),
      terminal: false,
      requiresHumanReview: true,
      reason:
        'Failure could not be classified to a known root cause. Route to human review. ' +
        'No automated retry is permitted for an unknown failure.',
      evidence: ['cause=UNKNOWN', 'no_auto_retry'],
    };
  },
};

/** Exhaustive: TypeScript enforces one playbook per RootCause. */
export const PLAYBOOKS: Record<RootCause, Playbook> = {
  CUSTOMER_FUNDS_LOW: customerFundsLow,
  ISSUER_TEMPORARY_FAILURE: issuerTemporaryFailure,
  GATEWAY_FAILURE: gatewayFailure,
  CUSTOMER_ABANDONMENT: customerAbandonment,
  CUSTOMER_AUTH_FAILURE: customerAuthFailure,
  PAYMENT_METHOD_INVALID: paymentMethodInvalid,
  MANDATE_INVALID: mandateInvalid,
  UNKNOWN: unknown,
};

export const ALL_PLAYBOOKS: readonly Playbook[] = Object.values(PLAYBOOKS);
