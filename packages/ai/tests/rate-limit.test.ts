import { describe, expect, it } from 'vitest';
import { withRateLimit } from '../src/rate-limit';
import { generateRecoveryMessage } from '../src/message-generator';
import type { RecoveryMessageInput } from '../src/types';
import { successClient } from './_fake-client';

const input: RecoveryMessageInput = {
  paymentId: 'pay_1',
  amountMinor: 250000,
  currency: 'INR',
  paymentMethod: 'UPI',
  rootCause: 'ISSUER_TEMPORARY_FAILURE',
  recoveryAction: 'RETRY',
  customerLanguage: 'EN',
};

const generated = {
  message: 'Your bank is temporarily unavailable. We will try again shortly.',
  language: 'EN' as const,
  reason: 'Communicates a temporary issuer failure.',
};

describe('AI usage ceiling (Phase 14 §12)', () => {
  it('allows calls up to the configured budget', async () => {
    const client = withRateLimit(successClient(generated), { maxCallsPerMinute: 3 });
    for (let i = 0; i < 3; i += 1) {
      const result = await generateRecoveryMessage(input, { client });
      expect(result.source).toBe('AI');
    }
  });

  it('falls back rather than failing once the budget is exhausted', async () => {
    const client = withRateLimit(successClient(generated), { maxCallsPerMinute: 2 });
    await generateRecoveryMessage(input, { client });
    await generateRecoveryMessage(input, { client });

    // Third call is over budget — the generator must still return a usable
    // message, just a deterministic one. Recovery is never blocked by cost.
    const third = await generateRecoveryMessage(input, { client });
    expect(third.source).toBe('FALLBACK');
    expect(third.value.message.length).toBeGreaterThan(0);
  });

  it('refills at the start of the next window', async () => {
    let t = 0;
    const client = withRateLimit(successClient(generated), {
      maxCallsPerMinute: 1,
      now: () => t,
    });

    expect((await generateRecoveryMessage(input, { client })).source).toBe('AI');
    expect((await generateRecoveryMessage(input, { client })).source).toBe('FALLBACK');

    t += 60_001;
    expect((await generateRecoveryMessage(input, { client })).source).toBe('AI');
  });
});
