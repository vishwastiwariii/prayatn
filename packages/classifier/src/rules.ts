import type { NormalizedInput, Rule, RuleEvaluation } from './types';
import { textIncludes } from './normalize';

/**
 * The rule table.
 *
 * PRECEDENCE IS EXPLICIT: each rule owns a unique `priority` and the winner is
 * always `min(priority)` among the rules that matched — never array order,
 * never if/else nesting. The array below is kept in priority order purely for
 * readability; `classify()` re-sorts defensively.
 *
 * Ordering rationale (lower = wins):
 *   10 MANDATE_INVALID          structural: the mandate itself is gone
 *   20 PAYMENT_METHOD_INVALID   structural: the instrument itself is unusable
 *   30 CUSTOMER_FUNDS_LOW       specific, unambiguous customer-side reason
 *   40 CUSTOMER_AUTH_FAILURE    explicit auth rejection (ACS said "no")
 *   50 CUSTOMER_ABANDONMENT     inferred drop-off (weaker than an explicit "no")
 *   60 ISSUER_TEMPORARY_FAILURE transient bank-side condition
 *   70 GATEWAY_FAILURE          transient gateway/infra condition
 *  (UNKNOWN is the fallback in classify(), not a row here.)
 *
 * Every rule diagnoses a cause. No rule decides a recovery action.
 */

// --- small deterministic matchers ----------------------------------------

/**
 * First reason "key" from `keys` that the canonical reason matches, or
 * undefined. A key matches when it is a whole reason-token, or the canonical
 * reason equals / contains it (so underscored multi-word keys like
 * `issuer_timeout` match too). Partial-word hits are impossible because keys
 * are curated and the reason is canonicalised.
 */
function anyToken(n: NormalizedInput, keys: readonly string[]): string | undefined {
  return keys.find((k) => n.reasonTokens.has(k) || n.reason === k || n.reason.includes(k));
}

/** True if any group's tokens are ALL present in the reason. */
function anyTokenGroup(n: NormalizedInput, groups: readonly (readonly string[])[]): boolean {
  return groups.some((group) => group.every((t) => n.reasonTokens.has(t)));
}

/** First needle from `needles` found in reason or description, or undefined. */
function anyText(n: NormalizedInput, needles: readonly string[]): string | undefined {
  return needles.find((needle) => textIncludes(n, needle));
}

function noMatch(): RuleEvaluation {
  return { matched: false };
}

// --- rules --------------------------------------------------------------

const mandateInvalid: Rule = {
  id: 'MANDATE_REVOKED_001',
  cause: 'MANDATE_INVALID',
  priority: 10,
  description:
    'The mandate / e-mandate / subscription authorization backing this payment is no longer valid (revoked, cancelled, paused or never registered).',
  evaluate(n) {
    const token = anyToken(n, [
      'mandate_revoked',
      'mandate_cancelled',
      'mandate_canceled',
      'mandate_paused',
      'mandate_invalid',
      'mandate_not_found',
      'mandate_inactive',
      'subscription_cancelled',
    ]);
    if (
      token ||
      anyTokenGroup(n, [
        ['mandate', 'revoked'],
        ['mandate', 'cancelled'],
        ['mandate', 'canceled'],
        ['mandate', 'paused'],
        ['mandate', 'inactive'],
        ['emandate', 'revoked'],
      ])
    ) {
      return {
        matched: true,
        confidence: 0.99,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token ?? 'mandate+state'}`],
      };
    }

    if (
      n.source === 'BUSINESS' &&
      textIncludes(n, 'mandate') &&
      anyText(n, ['revoked', 'cancel', 'stopped', 'withdrawn', 'no longer valid'])
    ) {
      return {
        matched: true,
        confidence: 0.95,
        strength: 'COMPOSITE',
        evidence: ['source=BUSINESS', 'text~mandate', 'text~revoked|cancelled'],
      };
    }

    const phrase = anyText(n, [
      'mandate revoked',
      'mandate cancelled',
      'mandate is cancelled',
      'mandate not registered',
      'mandate no longer valid',
      'emandate revoked',
    ]);
    if (phrase) {
      return {
        matched: true,
        confidence: 0.85,
        strength: 'DESCRIPTION',
        evidence: [`description~"${phrase}"`],
      };
    }
    return noMatch();
  },
};

const paymentMethodInvalid: Rule = {
  id: 'CARD_INVALID_001',
  cause: 'PAYMENT_METHOD_INVALID',
  priority: 20,
  description:
    'The payment instrument itself is structurally unusable — expired card, invalid / incorrect card number, or a permanently dead card.',
  evaluate(n) {
    const token = anyToken(n, [
      'expired_card',
      'card_expired',
      'invalid_card',
      'card_invalid',
      'invalid_card_number',
      'incorrect_card_number',
      'incorrect_card_details',
      'dead_card',
      'card_not_supported',
    ]);
    if (
      token ||
      anyTokenGroup(n, [
        ['card', 'expired'],
        ['card', 'invalid'],
        ['expired', 'instrument'],
      ])
    ) {
      return {
        matched: true,
        confidence: 0.97,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token ?? 'card+state'}`],
      };
    }

    if (n.code.includes('expired_card') || n.code.includes('invalid_card')) {
      return {
        matched: true,
        confidence: 0.95,
        strength: 'ERROR_CODE',
        evidence: [`code=${n.code}`],
      };
    }

    const phrase = anyText(n, [
      'card has expired',
      'expired card',
      'card expired',
      'invalid card number',
      'card number is invalid',
      'card is invalid',
      'incorrect card details',
    ]);
    if (phrase) {
      return {
        matched: true,
        confidence: 0.8,
        strength: 'DESCRIPTION',
        evidence: [`description~"${phrase}"`],
      };
    }
    return noMatch();
  },
};

const customerFundsLow: Rule = {
  id: 'FUNDS_LOW_001',
  cause: 'CUSTOMER_FUNDS_LOW',
  priority: 30,
  description:
    'The bank declined the authorization because the customer account did not hold enough money to cover the amount at the time of the attempt.',
  evaluate(n) {
    const token = anyToken(n, [
      'insufficient_funds',
      'insufficient_balance',
      'low_balance',
      'not_enough_balance',
      'not_enough_funds',
      'nsf',
    ]);
    if (
      token ||
      anyTokenGroup(n, [
        ['insufficient', 'funds'],
        ['insufficient', 'balance'],
        ['not', 'enough', 'balance'],
        ['not', 'enough', 'funds'],
      ])
    ) {
      return {
        matched: true,
        confidence: 0.98,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token ?? 'insufficient+funds'}`],
      };
    }

    if (n.code.includes('insufficient_funds') || n.code.includes('insufficient_balance')) {
      return {
        matched: true,
        confidence: 0.95,
        strength: 'ERROR_CODE',
        evidence: [`code=${n.code}`],
      };
    }

    const phrase = anyText(n, [
      'insufficient fund',
      'insufficient balance',
      'not enough balance',
      'not enough funds',
      'low balance',
      'balance is low',
    ]);
    if (phrase) {
      return {
        matched: true,
        confidence: 0.8,
        strength: 'DESCRIPTION',
        evidence: [`description~"${phrase}"`],
      };
    }
    return noMatch();
  },
};

const customerAuthFailure: Rule = {
  id: 'CUSTOMER_AUTH_001',
  cause: 'CUSTOMER_AUTH_FAILURE',
  priority: 40,
  description:
    'Authentication was attempted and explicitly rejected — 3-D Secure failed, or the customer entered an incorrect OTP / PIN / password.',
  evaluate(n) {
    const token = anyToken(n, [
      'authentication_failed',
      'auth_failed',
      '3ds_failed',
      'three_ds_failed',
      'otp_incorrect',
      'incorrect_otp',
      'invalid_otp',
      'otp_failed',
      'pin_incorrect',
      'incorrect_pin',
      'wrong_password',
      'authentication_error',
    ]);
    if (
      token ||
      anyTokenGroup(n, [
        ['authentication', 'failed'],
        ['auth', 'failed'],
        ['incorrect', 'otp'],
        ['wrong', 'otp'],
        ['invalid', 'otp'],
        ['incorrect', 'pin'],
        ['3ds', 'failed'],
      ])
    ) {
      return {
        matched: true,
        confidence: 0.9,
        strength: 'EXACT_REASON',
        evidence: [
          `reason=${n.reason}`,
          `step=${n.step}`,
          `matched_token=${token ?? 'auth+failed'}`,
        ],
      };
    }

    if (
      n.step === 'AUTHENTICATION' &&
      n.source === 'CUSTOMER' &&
      anyText(n, ['failed', 'incorrect', 'invalid', 'declined', 'mismatch']) &&
      !textIncludes(n, 'abandon')
    ) {
      return {
        matched: true,
        confidence: 0.82,
        strength: 'COMPOSITE',
        evidence: ['step=AUTHENTICATION', 'source=CUSTOMER', 'text~failed|incorrect'],
      };
    }

    const phrase = anyText(n, [
      'authentication failed',
      '3d secure authentication failed',
      '3ds authentication failed',
      'incorrect otp',
      'otp validation failed',
      'failed to authenticate',
      'authentication unsuccessful',
    ]);
    if (phrase) {
      return {
        matched: true,
        confidence: 0.75,
        strength: 'DESCRIPTION',
        evidence: [`description~"${phrase}"`],
      };
    }
    return noMatch();
  },
};

const customerAbandonment: Rule = {
  id: 'CUSTOMER_ABANDON_001',
  cause: 'CUSTOMER_ABANDONMENT',
  priority: 50,
  description:
    'The customer started but never completed the authentication / approval step — the 3-D Secure page or UPI collect request was left to expire.',
  evaluate(n) {
    const token = anyToken(n, [
      '3ds_abandoned',
      'three_ds_abandoned',
      'authentication_abandoned',
      'auth_abandoned',
      'user_abandoned',
      'payment_abandoned',
      'checkout_abandoned',
      'abandoned',
      'customer_dropped',
      'user_dropped',
      'not_completed',
      'user_cancelled',
      'cancelled_by_user',
      'upi_collect_expired',
      'collect_request_expired',
    ]);
    if (
      token ||
      anyTokenGroup(n, [
        ['3ds', 'abandoned'],
        ['authentication', 'abandoned'],
        ['authentication', 'not', 'completed'],
        ['user', 'cancelled'],
        ['user', 'dropped'],
        ['customer', 'abandoned'],
        ['collect', 'expired'],
        ['collect', 'timeout'],
      ])
    ) {
      return {
        matched: true,
        confidence: 0.85,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token ?? 'abandon+state'}`],
      };
    }

    if (
      (n.step === 'AUTHENTICATION' || n.method === 'UPI') &&
      anyText(n, [
        'abandon',
        'not completed',
        'did not complete',
        'cancelled by user',
        'user dropped',
        'no response from customer',
        'customer did not respond',
        'collect request expired',
        'request expired',
        'timed out waiting for',
      ])
    ) {
      return {
        matched: true,
        confidence: 0.8,
        strength: 'COMPOSITE',
        evidence: [`step=${n.step}`, `method=${n.method}`, 'text~abandon|expired|not completed'],
      };
    }

    const phrase = anyText(n, [
      'customer did not complete',
      'abandoned the payment',
      'authentication was not completed',
      'user cancelled the payment',
      'collect request expired',
    ]);
    if (phrase) {
      return {
        matched: true,
        confidence: 0.72,
        strength: 'DESCRIPTION',
        evidence: [`description~"${phrase}"`],
      };
    }
    return noMatch();
  },
};

const issuerTemporaryFailure: Rule = {
  id: 'ISSUER_TEMP_001',
  cause: 'ISSUER_TEMPORARY_FAILURE',
  priority: 60,
  description:
    'The issuing bank was reachable but could not process the authorization right now — it timed out, returned a temporary decline, or asked to try again later.',
  evaluate(n) {
    const token = anyToken(n, [
      'issuer_timeout',
      'issuer_unavailable',
      'issuer_down',
      'bank_timeout',
      'issuer_temporarily_unavailable',
      'auth_timeout',
      'authorization_timeout',
      'issuer_not_available',
      'try_again_later',
    ]);
    if (token) {
      return {
        matched: true,
        confidence: 0.94,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token}`],
      };
    }

    if (
      n.source === 'BANK' &&
      anyText(n, [
        'timeout',
        'timed out',
        'temporarily',
        'temporary',
        'try again',
        'unavailable',
        'did not respond',
        'no response',
        'issuer down',
        'system error',
        'processing error',
        'please retry',
        '5xx',
      ])
    ) {
      return {
        matched: true,
        confidence: 0.92,
        strength: 'COMPOSITE',
        evidence: ['source=BANK', 'text~timeout|temporary|unavailable'],
      };
    }

    if (
      n.source === 'BANK' &&
      anyText(n, [
        'please try again',
        'temporarily unavailable',
        'issuer not available',
        'bank did not respond',
      ])
    ) {
      return {
        matched: true,
        confidence: 0.8,
        strength: 'DESCRIPTION',
        evidence: ['source=BANK', 'description~temporary'],
      };
    }
    return noMatch();
  },
};

const gatewayFailure: Rule = {
  id: 'GATEWAY_FAIL_001',
  cause: 'GATEWAY_FAILURE',
  priority: 70,
  description:
    'The payment gateway / aggregator itself errored before the bank could give a verdict — a 5xx response, an upstream timeout, or an internal processing error.',
  evaluate(n) {
    const token = anyToken(n, [
      'gateway_timeout',
      'gateway_error',
      'gateway_5xx',
      'server_error',
      'internal_server_error',
      'service_unavailable',
      'bad_gateway',
      'upstream_error',
      'connection_error',
    ]);
    if (token) {
      return {
        matched: true,
        confidence: 0.92,
        strength: 'EXACT_REASON',
        evidence: [`reason=${n.reason}`, `matched_token=${token}`],
      };
    }

    if (
      n.source === 'GATEWAY' &&
      anyText(n, [
        '5xx',
        '500',
        '502',
        '503',
        '504',
        'server error',
        'internal error',
        'gateway timeout',
        'bad gateway',
        'service unavailable',
        'upstream',
        'connection reset',
        'processing error',
        'could not be processed',
      ])
    ) {
      return {
        matched: true,
        confidence: 0.9,
        strength: 'COMPOSITE',
        evidence: ['source=GATEWAY', 'text~5xx|timeout|unavailable'],
      };
    }

    if (
      n.source === 'GATEWAY' &&
      textIncludes(n, 'gateway') &&
      anyText(n, ['error', 'timeout', 'unavailable', 'fail'])
    ) {
      return {
        matched: true,
        confidence: 0.78,
        strength: 'DESCRIPTION',
        evidence: ['source=GATEWAY', 'description~gateway error'],
      };
    }
    return noMatch();
  },
};

/**
 * Precedence-ordered rule table. Exported for tests that assert priorities are
 * unique and strictly ascending.
 */
export const RULES: readonly Rule[] = [
  mandateInvalid,
  paymentMethodInvalid,
  customerFundsLow,
  customerAuthFailure,
  customerAbandonment,
  issuerTemporaryFailure,
  gatewayFailure,
];
