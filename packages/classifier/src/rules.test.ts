import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import type { ClassifierInput } from './types';

function input(over: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    errorCode: 'BAD_REQUEST_ERROR',
    errorReason: 'unspecified',
    errorSource: 'GATEWAY',
    errorStep: 'AUTHORIZATION',
    errorDescription: '',
    method: 'CARD',
    ...over,
  };
}

describe('rule: FUNDS_LOW_001 -> CUSTOMER_FUNDS_LOW', () => {
  it('exact reason token', () => {
    const r = classify(input({ errorReason: 'insufficient_funds', errorSource: 'BANK' }));
    expect(r.cause).toBe('CUSTOMER_FUNDS_LOW');
    expect(r.ruleId).toBe('FUNDS_LOW_001');
    expect(r.confidence).toBe(0.98);
    expect(r.evidence).toContain('reason=insufficient_funds');
  });

  it('two-token reason ("insufficient balance")', () => {
    const r = classify(input({ errorReason: 'insufficient balance', errorSource: 'BANK' }));
    expect(r.cause).toBe('CUSTOMER_FUNDS_LOW');
    expect(r.confidence).toBe(0.98);
  });

  it('description fallback is lower confidence', () => {
    const r = classify(
      input({
        errorReason: 'declined',
        errorDescription: 'Transaction declined due to insufficient balance',
      }),
    );
    expect(r.cause).toBe('CUSTOMER_FUNDS_LOW');
    expect(r.confidence).toBe(0.8);
  });
});

describe('rule: CARD_INVALID_001 -> PAYMENT_METHOD_INVALID', () => {
  it('expired_card reason', () => {
    const r = classify(input({ errorReason: 'expired_card', errorSource: 'BANK' }));
    expect(r.cause).toBe('PAYMENT_METHOD_INVALID');
    expect(r.confidence).toBe(0.97);
  });

  it('invalid card number reason', () => {
    const r = classify(input({ errorReason: 'invalid_card_number' }));
    expect(r.cause).toBe('PAYMENT_METHOD_INVALID');
  });

  it('error code carries the signal', () => {
    const r = classify(input({ errorReason: 'declined', errorCode: 'INVALID_CARD' }));
    expect(r.cause).toBe('PAYMENT_METHOD_INVALID');
    expect(r.confidence).toBe(0.95);
  });
});

describe('rule: MANDATE_REVOKED_001 -> MANDATE_INVALID', () => {
  it('mandate_revoked reason', () => {
    const r = classify(
      input({ errorReason: 'mandate_revoked', errorSource: 'BUSINESS', method: 'MANDATE' }),
    );
    expect(r.cause).toBe('MANDATE_INVALID');
    expect(r.confidence).toBe(0.99);
  });

  it('two-token reason ("mandate cancelled")', () => {
    const r = classify(input({ errorReason: 'mandate cancelled', method: 'MANDATE' }));
    expect(r.cause).toBe('MANDATE_INVALID');
  });

  it('composite: business source + mandate text', () => {
    const r = classify(
      input({
        errorReason: 'payment_failed',
        errorSource: 'BUSINESS',
        errorDescription: 'The e-mandate for this subscription was revoked by the customer',
        method: 'MANDATE',
      }),
    );
    expect(r.cause).toBe('MANDATE_INVALID');
    expect(r.confidence).toBe(0.95);
  });
});

describe('rule: CUSTOMER_AUTH_001 -> CUSTOMER_AUTH_FAILURE', () => {
  it('authentication_failed reason', () => {
    const r = classify(
      input({
        errorReason: 'authentication_failed',
        errorSource: 'CUSTOMER',
        errorStep: 'AUTHENTICATION',
      }),
    );
    expect(r.cause).toBe('CUSTOMER_AUTH_FAILURE');
    expect(r.confidence).toBe(0.9);
  });

  it('incorrect OTP reason', () => {
    const r = classify(
      input({ errorReason: 'incorrect_otp', errorSource: 'CUSTOMER', errorStep: 'AUTHENTICATION' }),
    );
    expect(r.cause).toBe('CUSTOMER_AUTH_FAILURE');
  });

  it('composite: auth step + customer source + "failed" text (not abandonment)', () => {
    const r = classify(
      input({
        errorReason: 'three_ds',
        errorSource: 'CUSTOMER',
        errorStep: 'AUTHENTICATION',
        errorDescription: '3D Secure check was declined by the issuer ACS',
      }),
    );
    expect(r.cause).toBe('CUSTOMER_AUTH_FAILURE');
    expect(r.confidence).toBe(0.82);
  });
});

describe('rule: CUSTOMER_ABANDON_001 -> CUSTOMER_ABANDONMENT', () => {
  it('3ds_abandoned reason', () => {
    const r = classify(
      input({ errorReason: '3ds_abandoned', errorSource: 'CUSTOMER', errorStep: 'AUTHENTICATION' }),
    );
    expect(r.cause).toBe('CUSTOMER_ABANDONMENT');
    expect(r.confidence).toBe(0.85);
  });

  it('UPI collect request expired', () => {
    const r = classify(
      input({ errorReason: 'upi_collect_expired', method: 'UPI', errorSource: 'CUSTOMER' }),
    );
    expect(r.cause).toBe('CUSTOMER_ABANDONMENT');
  });

  it('composite: UPI + "not completed" text', () => {
    const r = classify(
      input({
        errorReason: 'collect_pending',
        method: 'UPI',
        errorDescription: 'Customer did not complete the collect request; it expired',
      }),
    );
    expect(r.cause).toBe('CUSTOMER_ABANDONMENT');
    expect(r.confidence).toBe(0.8);
  });
});

describe('rule: ISSUER_TEMP_001 -> ISSUER_TEMPORARY_FAILURE', () => {
  it('issuer_timeout reason', () => {
    const r = classify(input({ errorReason: 'issuer_timeout', errorSource: 'BANK' }));
    expect(r.cause).toBe('ISSUER_TEMPORARY_FAILURE');
    expect(r.confidence).toBe(0.94);
  });

  it('composite: bank source + "timed out" text', () => {
    const r = classify(
      input({
        errorReason: 'processing_error',
        errorSource: 'BANK',
        errorDescription: 'Issuer authorization request timed out',
      }),
    );
    expect(r.cause).toBe('ISSUER_TEMPORARY_FAILURE');
    expect(r.confidence).toBe(0.92);
  });
});

describe('rule: GATEWAY_FAIL_001 -> GATEWAY_FAILURE', () => {
  it('gateway_timeout reason', () => {
    const r = classify(input({ errorReason: 'gateway_timeout', errorSource: 'GATEWAY' }));
    expect(r.cause).toBe('GATEWAY_FAILURE');
    expect(r.confidence).toBe(0.92);
  });

  it('composite: gateway source + 5xx text', () => {
    const r = classify(
      input({
        errorReason: 'upstream_failure',
        errorSource: 'GATEWAY',
        errorDescription: 'Received HTTP 503 Service Unavailable from upstream',
      }),
    );
    expect(r.cause).toBe('GATEWAY_FAILURE');
    expect(r.confidence).toBe(0.9);
  });
});

describe('every RootCause value is reachable', () => {
  const cases: Array<[string, ClassifierInput]> = [
    ['CUSTOMER_FUNDS_LOW', input({ errorReason: 'insufficient_funds', errorSource: 'BANK' })],
    ['PAYMENT_METHOD_INVALID', input({ errorReason: 'expired_card' })],
    ['MANDATE_INVALID', input({ errorReason: 'mandate_revoked', method: 'MANDATE' })],
    [
      'CUSTOMER_AUTH_FAILURE',
      input({
        errorReason: 'authentication_failed',
        errorStep: 'AUTHENTICATION',
        errorSource: 'CUSTOMER',
      }),
    ],
    [
      'CUSTOMER_ABANDONMENT',
      input({ errorReason: '3ds_abandoned', errorStep: 'AUTHENTICATION', errorSource: 'CUSTOMER' }),
    ],
    ['ISSUER_TEMPORARY_FAILURE', input({ errorReason: 'issuer_timeout', errorSource: 'BANK' })],
    ['GATEWAY_FAILURE', input({ errorReason: 'gateway_5xx', errorSource: 'GATEWAY' })],
    ['UNKNOWN', input({ errorReason: 'flux_capacitor_desync', errorSource: 'GATEWAY' })],
  ];

  it.each(cases)('produces %s', (expected, inp) => {
    expect(classify(inp).cause).toBe(expected);
  });

  it('covers all 8 domain RootCause values', () => {
    const produced = new Set(cases.map(([c]) => c));
    expect(produced.size).toBe(8);
  });
});
