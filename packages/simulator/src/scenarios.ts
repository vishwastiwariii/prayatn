import type { Rng } from './rng';

/**
 * The nine hidden scenarios. A payment is secretly ONE of these; Recovery Desk
 * only ever sees `FailureDescriptor` (the same shape Phase 4 ingests) and the
 * SUCCESS/FAILURE verdict — never the fields below that actually decide it.
 */
export type ScenarioKind =
  | 'ISSUER_TEMPORARY'
  | 'GATEWAY_5XX'
  | 'FUNDS_LOW'
  | 'AUTH_FAILURE'
  | 'ABANDONMENT'
  | 'INVALID_METHOD'
  | 'MANDATE_REVOKED'
  | 'UNKNOWN';

/** What the outside world (Recovery Desk) is allowed to see about a failure. */
export interface FailureDescriptor {
  code: string;
  reason: string;
  source: 'CUSTOMER' | 'BANK' | 'GATEWAY' | 'BUSINESS';
  step: 'AUTHENTICATION' | 'AUTHORIZATION' | 'CAPTURE';
  description: string;
}

/** The hidden truth for one payment. NEVER handed to a strategy. */
export interface SimulationTruth {
  kind: ScenarioKind;
  publicFailure: FailureDescriptor;
  /** issuer / gateway / funds: an attempt succeeds once `atMs >= resolvesAtMs`. */
  resolvesAtMs?: number;
  /** auth / abandonment: needs a customer nudge (message or rail switch) first. */
  needsNudge?: boolean;
  /** auth / abandonment: whether the customer actually comes back after a nudge. */
  customerCooperates?: boolean;
  /** invalid method / mandate / unknown: no attempt ever succeeds. */
  permanent?: boolean;
}

export interface AttemptContext {
  attemptNumber: number;
  atMs: number;
  originatedAtMs: number;
  messagesSent: number;
  railSwitched: boolean;
}

export interface AttemptVerdict {
  status: 'SUCCESS' | 'FAILURE';
  failure?: FailureDescriptor;
}

const HOUR = 60 * 60_000;
const MIN = 60_000;

// --- public failure descriptors ----------------------------------------

const DESCRIPTORS: Record<ScenarioKind, (method: string) => FailureDescriptor> = {
  ISSUER_TEMPORARY: () => ({
    code: 'GATEWAY_ERROR',
    reason: 'issuer_timeout',
    source: 'BANK',
    step: 'AUTHORIZATION',
    description: 'Issuer did not respond within the authorization window',
  }),
  GATEWAY_5XX: () => ({
    code: 'GATEWAY_ERROR',
    reason: 'gateway_5xx',
    source: 'GATEWAY',
    step: 'AUTHORIZATION',
    description: 'Payment gateway returned HTTP 503 Service Unavailable',
  }),
  FUNDS_LOW: () => ({
    code: 'BAD_REQUEST_ERROR',
    reason: 'insufficient_funds',
    source: 'CUSTOMER',
    step: 'AUTHORIZATION',
    description: 'Insufficient balance in the customer account',
  }),
  AUTH_FAILURE: () => ({
    code: 'BAD_REQUEST_ERROR',
    reason: 'authentication_failed',
    source: 'CUSTOMER',
    step: 'AUTHENTICATION',
    description: 'Customer failed 3-D Secure authentication (incorrect OTP)',
  }),
  ABANDONMENT: (method) => ({
    code: 'BAD_REQUEST_ERROR',
    reason: method === 'UPI' ? 'upi_collect_timeout' : '3ds_abandoned',
    source: 'CUSTOMER',
    step: 'AUTHENTICATION',
    description:
      method === 'UPI'
        ? 'Customer did not approve the UPI collect request; it expired'
        : 'Customer did not complete the 3-D Secure authentication page',
  }),
  INVALID_METHOD: () => ({
    code: 'BAD_REQUEST_ERROR',
    reason: 'expired_card',
    source: 'BANK',
    step: 'AUTHORIZATION',
    description: 'The card has expired',
  }),
  MANDATE_REVOKED: () => ({
    code: 'BAD_REQUEST_ERROR',
    reason: 'mandate_revoked',
    source: 'BUSINESS',
    step: 'AUTHORIZATION',
    description: 'The e-mandate for this subscription has been revoked',
  }),
  UNKNOWN: () => ({
    code: 'GATEWAY_ERROR',
    reason: 'authorization_response_mismatch',
    source: 'GATEWAY',
    step: 'AUTHORIZATION',
    description: 'Authorization response could not be reconciled with the request',
  }),
};

// --- hidden-truth factories ------------------------------------------

/**
 * Build the hidden truth for a payment of `kind`. `rng` is a per-payment fork
 * so every knob is reproducible. `originatedAtMs` anchors time-based windows.
 */
export function buildTruth(
  kind: ScenarioKind,
  method: string,
  originatedAtMs: number,
  salaryDay: number,
  rng: Rng,
): SimulationTruth {
  const publicFailure = DESCRIPTORS[kind](method);

  switch (kind) {
    case 'ISSUER_TEMPORARY': {
      // ~30% clear within seconds (a true blip that a fast naive retry catches);
      // the rest are real multi-minute outages that need a timed retry.
      const outageMs = rng.chance(0.3) ? rng.float(500, 7_000) : rng.float(6 * MIN, 45 * MIN);
      return { kind, publicFailure, resolvesAtMs: originatedAtMs + outageMs };
    }
    case 'GATEWAY_5XX': {
      const degradedMs = rng.chance(0.35) ? rng.float(300, 7_000) : rng.float(3 * MIN, 25 * MIN);
      return { kind, publicFailure, resolvesAtMs: originatedAtMs + degradedMs };
    }
    case 'FUNDS_LOW': {
      // ~8% top up almost immediately; otherwise money lands near the salary day.
      if (rng.chance(0.08)) {
        return { kind, publicFailure, resolvesAtMs: originatedAtMs + rng.float(1_000, 6_000) };
      }
      const originated = new Date(originatedAtMs);
      const day = Math.min(28, Math.max(1, salaryDay));
      let credit = new Date(
        Date.UTC(originated.getUTCFullYear(), originated.getUTCMonth(), day, 9, 0, 0, 0),
      );
      if (credit.getTime() <= originatedAtMs)
        credit = new Date(credit.setUTCMonth(credit.getUTCMonth() + 1));
      // A little noise so it is not exactly the policy's assumed instant.
      const jitterMs = rng.float(-6 * HOUR, 18 * HOUR);
      return { kind, publicFailure, resolvesAtMs: credit.getTime() + jitterMs };
    }
    case 'AUTH_FAILURE':
      return { kind, publicFailure, needsNudge: true, customerCooperates: rng.chance(0.55) };
    case 'ABANDONMENT':
      return { kind, publicFailure, needsNudge: true, customerCooperates: rng.chance(0.62) };
    case 'INVALID_METHOD':
    case 'MANDATE_REVOKED':
    case 'UNKNOWN':
      return { kind, publicFailure, permanent: true };
  }
}

// --- verdict ---------------------------------------------------------

export function evaluateAttempt(truth: SimulationTruth, ctx: AttemptContext): AttemptVerdict {
  const fail: AttemptVerdict = { status: 'FAILURE', failure: truth.publicFailure };

  if (truth.permanent) return fail;

  if (truth.resolvesAtMs != null) {
    return ctx.atMs >= truth.resolvesAtMs ? { status: 'SUCCESS' } : fail;
  }

  if (truth.needsNudge) {
    const nudged = ctx.messagesSent >= 1 || ctx.railSwitched;
    return nudged && truth.customerCooperates === true ? { status: 'SUCCESS' } : fail;
  }

  return fail;
}
