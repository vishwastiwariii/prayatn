import { describe, expect, it } from 'vitest';
import { generateMerchantExplanation } from '../src/explanation-generator';
import type { MerchantExplanation, MerchantExplanationInput } from '../src/types';
import { successClient, throwingClient } from './_fake-client';

function baseInput(overrides: Partial<MerchantExplanationInput> = {}): MerchantExplanationInput {
  return {
    paymentMethod: 'CARD',
    rootCause: 'ISSUER_TEMPORARY_FAILURE',
    confidence: 0.97,
    recoveryAction: 'WAIT',
    reason: 'Issuer failed temporarily. Retry after an 18-minute cooldown to let the issuer recover.',
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('generateMerchantExplanation — fallback to policy.reason', () => {
  it('falls back to the deterministic reason verbatim when AI is unavailable', async () => {
    const input = baseInput();
    const result = await generateMerchantExplanation(input, { client: null });
    expect(result.source).toBe('FALLBACK');
    expect(result.value.explanation).toBe(input.reason);
  });

  it.each(['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMIT'] as const)(
    'falls back to policy.reason on %s',
    async (kind) => {
      const input = baseInput();
      const result = await generateMerchantExplanation(input, { client: throwingClient(kind) });
      expect(result.source).toBe('FALLBACK');
      expect(result.value.explanation).toBe(input.reason);
    },
  );
});

describe('generateMerchantExplanation — AI available', () => {
  it('never contradicts the underlying decision (the AI reason is additive, not a fallback fabrication)', async () => {
    const explanation: MerchantExplanation = {
      summary: 'Delayed retry recommended.',
      explanation:
        'The failure came from a temporary issuer problem. Retrying immediately could waste an attempt.',
    };
    const result = await generateMerchantExplanation(baseInput(), { client: successClient(explanation) });
    expect(result.source).toBe('AI');
    expect(result.value).toEqual(explanation);
  });
});
