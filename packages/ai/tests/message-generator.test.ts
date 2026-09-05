import type { RootCause } from '@recovery-desk/domain';
import { describe, expect, it } from 'vitest';
import { generateRecoveryMessage } from '../src/message-generator';
import type { GeneratedMessage, RecoveryMessageInput } from '../src/types';
import { successClient, throwingClient } from './_fake-client';

const CASES: Array<{ rootCause: RootCause; recoveryAction: RecoveryMessageInput['recoveryAction'] }> = [
  { rootCause: 'CUSTOMER_FUNDS_LOW', recoveryAction: 'WAIT' },
  { rootCause: 'ISSUER_TEMPORARY_FAILURE', recoveryAction: 'RETRY' },
  { rootCause: 'CUSTOMER_ABANDONMENT', recoveryAction: 'MESSAGE' },
  { rootCause: 'PAYMENT_METHOD_INVALID', recoveryAction: 'HARD_STOP' },
  { rootCause: 'MANDATE_INVALID', recoveryAction: 'HARD_STOP' },
  { rootCause: 'GATEWAY_FAILURE', recoveryAction: 'WAIT' },
];

function baseInput(overrides: Partial<RecoveryMessageInput> = {}): RecoveryMessageInput {
  return {
    paymentId: 'pay_1',
    amountMinor: 250000,
    currency: 'INR',
    paymentMethod: 'UPI',
    rootCause: 'ISSUER_TEMPORARY_FAILURE',
    recoveryAction: 'RETRY',
    delayMinutes: 18,
    customerLanguage: 'EN',
    ...overrides,
  };
}

describe('generateRecoveryMessage — fallback (no client configured)', () => {
  it.each(CASES)('falls back to a valid structured message for %s', async ({ rootCause, recoveryAction }) => {
    const result = await generateRecoveryMessage(baseInput({ rootCause, recoveryAction }), { client: null });
    expect(result.source).toBe('FALLBACK');
    expect(result.value.message.length).toBeGreaterThan(0);
    expect(result.value.language).toBe('EN');
  });

  it('respects the requested language in the fallback', async () => {
    const result = await generateRecoveryMessage(baseInput({ customerLanguage: 'HINGLISH' }), {
      client: null,
    });
    expect(result.value.language).toBe('HINGLISH');
  });
});

describe('generateRecoveryMessage — AI available', () => {
  it('returns the AI-generated structured message when the client succeeds', async () => {
    const generated: GeneratedMessage = {
      message: 'Your bank is temporarily unavailable. We will try again shortly.',
      language: 'EN',
      reason: 'Communicates a temporary issuer failure without promising recovery.',
    };
    const result = await generateRecoveryMessage(baseInput(), { client: successClient(generated) });
    expect(result.source).toBe('AI');
    expect(result.value).toEqual(generated);
    expect(result.usage?.operation).toBe('CUSTOMER_MESSAGE');
  });
});

describe('generateRecoveryMessage — AI failure handling (Phase 12 §21/§29)', () => {
  const kinds = ['TIMEOUT', 'INVALID_JSON', 'INVALID_ENUM', 'PROVIDER_ERROR', 'RATE_LIMIT'] as const;

  it.each(kinds)('%s never throws and falls back to a valid message', async (kind) => {
    const result = await generateRecoveryMessage(baseInput(), { client: throwingClient(kind) });
    expect(result.source).toBe('FALLBACK');
    expect(result.value.message.length).toBeGreaterThan(0);
  });
});

describe('generateRecoveryMessage — safety', () => {
  it('the fallback path never invents unsupported claims', async () => {
    const result = await generateRecoveryMessage(baseInput({ rootCause: 'ISSUER_TEMPORARY_FAILURE' }), {
      client: null,
    });
    const text = result.value.message.toLowerCase();
    expect(text).not.toMatch(/definitely|guarantee|refund|discount/);
  });
});
