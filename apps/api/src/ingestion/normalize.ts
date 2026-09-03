import type { FailureSource, FailureStep, PaymentMethod } from '@recovery-desk/domain';
import type { FlatFailureInput, ParsedFailurePayload, RazorpayWebhookInput } from './schema';
import type { NormalizationResult, NormalizedFailure } from './types';

/**
 * Normalization: pure, synchronous, no IO.
 *
 * Provider vocabularies are mapped onto our domain enums through small explicit
 * tables. Anything the tables cannot resolve is either:
 *   - defaulted, with a human-readable note recorded on the audit trail
 *     (`error_source`, `error_step`, missing `reason`/`description`), or
 *   - rejected as UNPROCESSABLE (`method`), because a wrong payment method
 *     would send the payment down the wrong recovery policy.
 */

const SOURCE_MAP: Record<string, FailureSource> = {
  customer: 'CUSTOMER',
  business: 'BUSINESS',
  merchant: 'BUSINESS',
  bank: 'BANK',
  issuer: 'BANK',
  gateway: 'GATEWAY',
  network: 'GATEWAY',
  npci: 'GATEWAY',
};

const STEP_MAP: Record<string, FailureStep> = {
  authentication: 'AUTHENTICATION',
  payment_authentication: 'AUTHENTICATION',
  authorization: 'AUTHORIZATION',
  payment_authorization: 'AUTHORIZATION',
  payment_initiation: 'AUTHORIZATION',
  capture: 'CAPTURE',
  payment_capture: 'CAPTURE',
};

const METHOD_MAP: Record<string, PaymentMethod> = {
  card: 'CARD',
  upi: 'UPI',
  upi_collect: 'UPI',
  upi_intent: 'UPI',
  netbanking: 'NETBANKING',
  wallet: 'WALLET',
  emandate: 'MANDATE',
  nach: 'MANDATE',
  upi_mandate: 'MANDATE',
  mandate: 'MANDATE',
};

const DEFAULT_SOURCE: FailureSource = 'GATEWAY';
const DEFAULT_STEP: FailureStep = 'AUTHORIZATION';

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Convert a paise (minor-unit) integer to a fixed 2dp major-unit string. */
function paiseToMajor(paise: number): string {
  return (paise / 100).toFixed(2);
}

interface CommonFields {
  paymentId: string;
  amount: string;
  currency: string;
  rawMethod: string;
  rawCode: string;
  rawReason: string | null | undefined;
  rawSource: string | null | undefined;
  rawStep: string | null | undefined;
  rawDescription: string | null | undefined;
  occurredAt: Date;
  ingestionSource: NormalizedFailure['ingestionSource'];
}

function fromWebhook(input: RazorpayWebhookInput): CommonFields {
  const e = input.payload.payment.entity;
  return {
    paymentId: e.id,
    amount: paiseToMajor(e.amount),
    currency: e.currency.toUpperCase(),
    rawMethod: e.method,
    rawCode: e.error_code,
    rawReason: e.error_reason,
    rawSource: e.error_source,
    rawStep: e.error_step,
    rawDescription: e.error_description,
    occurredAt: e.created_at ? new Date(e.created_at * 1000) : new Date(),
    ingestionSource: 'RAZORPAY_WEBHOOK',
  };
}

function fromFlat(input: FlatFailureInput): CommonFields {
  return {
    paymentId: input.paymentId,
    amount: input.amount.toFixed(2),
    currency: input.currency.toUpperCase(),
    rawMethod: input.method,
    rawCode: input.error.code,
    rawReason: input.error.reason,
    rawSource: input.error.source,
    rawStep: input.error.step,
    rawDescription: input.error.description,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    ingestionSource: 'FLAT_PAYLOAD',
  };
}

export function normalizeFailure(parsed: ParsedFailurePayload): NormalizationResult {
  const c = parsed.format === 'RAZORPAY_WEBHOOK' ? fromWebhook(parsed.data) : fromFlat(parsed.data);
  const notes: string[] = [];

  const method = METHOD_MAP[normalizeKey(c.rawMethod)];
  if (!method) {
    return { ok: false, message: `Unsupported payment method: "${c.rawMethod}"` };
  }

  let source = SOURCE_MAP[normalizeKey(c.rawSource ?? '')];
  if (!source) {
    source = DEFAULT_SOURCE;
    notes.push(
      c.rawSource
        ? `unrecognized error source "${c.rawSource}" -> ${DEFAULT_SOURCE}`
        : `missing error source -> ${DEFAULT_SOURCE}`,
    );
  }

  let step = STEP_MAP[normalizeKey(c.rawStep ?? '')];
  if (!step) {
    step = DEFAULT_STEP;
    notes.push(
      c.rawStep
        ? `unrecognized error step "${c.rawStep}" -> ${DEFAULT_STEP}`
        : `missing error step -> ${DEFAULT_STEP}`,
    );
  }

  let reason = c.rawReason?.trim();
  if (!reason) {
    reason = normalizeKey(c.rawCode);
    notes.push(`missing error reason -> derived "${reason}" from error code`);
  }

  let description = c.rawDescription?.trim();
  if (!description) {
    description = reason;
    notes.push('missing error description -> reused error reason');
  }

  const value: NormalizedFailure = {
    paymentId: c.paymentId,
    amount: c.amount,
    currency: c.currency,
    method,
    error: {
      code: c.rawCode.trim(),
      reason,
      source,
      step,
      description,
    },
    occurredAt: Number.isNaN(c.occurredAt.getTime()) ? new Date() : c.occurredAt,
    ingestionSource: c.ingestionSource,
  };

  return { ok: true, value, notes };
}
