import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { RULES } from './rules';
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

describe('rule table invariants', () => {
  it('every priority is unique', () => {
    const priorities = RULES.map((r) => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('every rule id is unique', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the table is stored in strictly ascending priority order', () => {
    const priorities = RULES.map((r) => r.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });
});

describe('explicit precedence when multiple signals match', () => {
  it('MANDATE_INVALID beats ISSUER_TEMPORARY_FAILURE', () => {
    // reason says the mandate is gone; description also looks like a bank timeout.
    const r = classify(
      input({
        errorReason: 'mandate_revoked',
        errorSource: 'BANK',
        errorDescription: 'Issuer request timed out while cancelling the revoked mandate',
        method: 'MANDATE',
      }),
    );
    expect(r.cause).toBe('MANDATE_INVALID');
    const causes = r.candidates.map((c) => c.cause);
    expect(causes).toContain('MANDATE_INVALID');
    expect(causes).toContain('ISSUER_TEMPORARY_FAILURE');
    // winner first, by priority
    expect(r.candidates[0]?.cause).toBe('MANDATE_INVALID');
    expect(r.explanation).toMatch(/takes precedence/);
  });

  it('PAYMENT_METHOD_INVALID beats CUSTOMER_FUNDS_LOW', () => {
    const r = classify(
      input({
        errorReason: 'expired_card',
        errorSource: 'BANK',
        errorDescription: 'Card has expired and the account had insufficient balance anyway',
      }),
    );
    expect(r.cause).toBe('PAYMENT_METHOD_INVALID');
    expect(r.candidates.map((c) => c.cause)).toEqual(
      expect.arrayContaining(['PAYMENT_METHOD_INVALID', 'CUSTOMER_FUNDS_LOW']),
    );
  });

  it('CUSTOMER_AUTH_FAILURE beats CUSTOMER_ABANDONMENT', () => {
    const r = classify(
      input({
        errorReason: 'authentication_failed',
        errorSource: 'CUSTOMER',
        errorStep: 'AUTHENTICATION',
        errorDescription: 'user abandoned after 3ds authentication failed',
      }),
    );
    expect(r.cause).toBe('CUSTOMER_AUTH_FAILURE');
    expect(r.candidates[0]?.priority).toBeLessThan(r.candidates[1]?.priority ?? Infinity);
  });

  it('ISSUER_TEMPORARY_FAILURE beats GATEWAY_FAILURE when both transient signals appear', () => {
    const r = classify(
      input({
        errorReason: 'gateway_timeout',
        errorSource: 'BANK',
        errorDescription: 'bank timed out; gateway also reported a 504',
      }),
    );
    expect(r.cause).toBe('ISSUER_TEMPORARY_FAILURE');
  });

  it('candidates are always ordered by ascending priority', () => {
    const r = classify(
      input({
        errorReason: 'mandate_revoked',
        errorSource: 'BANK',
        errorDescription: 'card expired, insufficient funds, issuer timed out, gateway 503',
        method: 'MANDATE',
      }),
    );
    const priorities = r.candidates.map((c) => c.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(r.cause).toBe(r.candidates[0]?.cause);
  });
});
