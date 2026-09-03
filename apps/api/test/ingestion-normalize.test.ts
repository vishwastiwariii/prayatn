import { describe, expect, it } from 'vitest';
import { normalizeFailure } from '../src/ingestion/normalize';
import { parseFailurePayload } from '../src/ingestion/schema';

function parse(body: unknown) {
  const r = parseFailurePayload(body);
  if (!r.ok) throw new Error('expected body to be valid: ' + JSON.stringify(r.issues));
  return r.value;
}

describe('parseFailurePayload', () => {
  it('routes the Razorpay webhook envelope to RAZORPAY_WEBHOOK', () => {
    const v = parse({
      event: 'payment.failed',
      payload: {
        payment: { entity: { id: 'pay_1', amount: 100, method: 'card', error_code: 'X' } },
      },
    });
    expect(v.format).toBe('RAZORPAY_WEBHOOK');
  });

  it('routes the flat payload to FLAT_PAYLOAD', () => {
    const v = parse({
      paymentId: 'pay_1',
      amount: 25,
      method: 'card',
      error: { code: 'X', reason: 'r', source: 'bank', step: 'authorization', description: 'd' },
    });
    expect(v.format).toBe('FLAT_PAYLOAD');
  });

  it('rejects a flat payload with a negative amount', () => {
    const r = parseFailurePayload({
      paymentId: 'pay_1',
      amount: -5,
      method: 'card',
      error: { code: 'X', reason: 'r', source: 'bank', step: 'authorization', description: 'd' },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a webhook with the wrong event name', () => {
    const r = parseFailurePayload({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'p', amount: 1, method: 'card', error_code: 'X' } } },
    });
    expect(r.ok).toBe(false);
  });
});

interface WebhookEntity {
  id: string;
  amount: number;
  currency: string;
  method: string;
  error_code: string;
  error_reason: string | null;
  error_source: string | null;
  error_step: string | null;
  error_description: string | null;
  created_at: number;
}

function webhookBody(entity: Partial<WebhookEntity> = {}) {
  const base: WebhookEntity = {
    id: 'pay_abc',
    amount: 250000, // paise
    currency: 'INR',
    method: 'upi',
    error_code: 'BAD_REQUEST_ERROR',
    error_reason: 'payment_upi_collect_expired',
    error_source: 'customer',
    error_step: 'payment_authorization',
    error_description: 'UPI collect request expired',
    created_at: 1_735_000_000,
  };
  return {
    event: 'payment.failed' as const,
    payload: { payment: { entity: { ...base, ...entity } } },
  };
}

describe('normalizeFailure — Razorpay webhook', () => {
  const base = webhookBody();

  it('converts paise to a 2dp major-unit string and maps every enum', () => {
    const r = normalizeFailure(parse(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amount).toBe('2500.00');
    expect(r.value.method).toBe('UPI');
    expect(r.value.error.source).toBe('CUSTOMER');
    expect(r.value.error.step).toBe('AUTHORIZATION');
    expect(r.value.occurredAt.toISOString()).toBe(new Date(1_735_000_000 * 1000).toISOString());
    expect(r.value.ingestionSource).toBe('RAZORPAY_WEBHOOK');
    expect(r.notes).toEqual([]);
  });

  it('defaults an unknown error_source to GATEWAY and records a note', () => {
    const r = normalizeFailure(parse(webhookBody({ error_source: 'martians' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.error.source).toBe('GATEWAY');
    expect(r.notes.join()).toMatch(/unrecognized error source "martians"/);
  });

  it('derives reason and description when the webhook omits them', () => {
    const r = normalizeFailure(parse(webhookBody({ error_reason: null, error_description: null })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.error.reason).toBe('bad_request_error');
    expect(r.value.error.description).toBe('bad_request_error');
    expect(r.notes).toHaveLength(2);
  });

  it('rejects an unsupported payment method as UNPROCESSABLE', () => {
    const r = normalizeFailure(parse(webhookBody({ method: 'crypto' })));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/Unsupported payment method: "crypto"/);
  });
});

describe('normalizeFailure — flat payload', () => {
  it('keeps the amount as given and maps aliases (issuer -> BANK)', () => {
    const r = normalizeFailure(
      parse({
        paymentId: 'pay_flat',
        amount: 1799.5,
        method: 'netbanking',
        error: {
          code: 'GATEWAY_ERROR',
          reason: 'issuer_timeout',
          source: 'issuer',
          step: 'authorization',
          description: 'Issuer did not respond',
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amount).toBe('1799.50');
    expect(r.value.method).toBe('NETBANKING');
    expect(r.value.error.source).toBe('BANK');
    expect(r.value.ingestionSource).toBe('FLAT_PAYLOAD');
  });
});
