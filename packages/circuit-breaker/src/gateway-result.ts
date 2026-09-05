/**
 * Gateway result model (Phase 10 §3).
 *
 * A gateway 5xx / timeout is NOT a customer payment failure. This module is the
 * single source of truth for that distinction.
 */

export type GatewayResult =
  | { status: 'SUCCESS' }
  | { status: 'PAYMENT_FAILURE'; reason: string }
  | { status: 'GATEWAY_FAILURE'; code: string; description: string };

/** Raw provider codes that mean "the gateway itself is unhealthy". */
const GATEWAY_FAILURE_CODES = new Set([
  '500',
  '502',
  '503',
  '504',
  'gateway_timeout',
  'gateway_5xx',
  'gateway_error',
  'bad_gateway',
  'service_unavailable',
  'timeout',
  'upstream_error',
  'connection_error',
]);

/** Raw provider codes that mean "the customer / instrument / mandate failed". */
const PAYMENT_FAILURE_HINTS = [
  'insufficient_funds',
  'card_expired',
  'expired_card',
  'incorrect_otp',
  'authentication_failed',
  'mandate_revoked',
  'issuer_declined',
  'dead_instrument',
  'do_not_honour',
];

export function isGatewayFailureCode(code: string): boolean {
  const c = code.trim().toLowerCase();
  if (GATEWAY_FAILURE_CODES.has(c)) return true;
  if (PAYMENT_FAILURE_HINTS.some((h) => c.includes(h))) return false;
  // A bare 5xx like "http_503" or "err_502"
  return /(^|[^0-9])5\d\d([^0-9]|$)/.test(c);
}

/** Normalise a mock-gateway charge result into the Phase 10 `GatewayResult`. */
export function toGatewayResult(charge: {
  status: 'SUCCESS' | 'FAILURE';
  code: string;
  reason: string;
}): GatewayResult {
  if (charge.status === 'SUCCESS') return { status: 'SUCCESS' };
  if (isGatewayFailureCode(charge.code)) {
    return { status: 'GATEWAY_FAILURE', code: charge.code, description: charge.reason };
  }
  return { status: 'PAYMENT_FAILURE', reason: charge.reason || charge.code };
}

export function isTransientGatewayFailure(
  result: GatewayResult,
): result is Extract<GatewayResult, { status: 'GATEWAY_FAILURE' }> {
  return result.status === 'GATEWAY_FAILURE';
}
