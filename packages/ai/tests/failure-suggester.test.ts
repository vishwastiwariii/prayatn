import { describe, expect, it } from 'vitest';
import { suggestFailureCause } from '../src/failure-suggester';
import { ALLOWED_ROOT_CAUSES, type FailureSuggestion, type FailureSuggestionInput } from '../src/types';
import { successClient, throwingClient } from './_fake-client';

function baseInput(overrides: Partial<FailureSuggestionInput> = {}): FailureSuggestionInput {
  return {
    errorCode: 'UNKNOWN_ERROR',
    errorReason: 'processor_rejected',
    errorSource: 'GATEWAY',
    errorStep: 'AUTHORIZATION',
    errorDescription: 'Transaction declined by upstream processor for undocumented reasons.',
    paymentMethod: 'CARD',
    ...overrides,
  };
}

describe('suggestFailureCause — never auto-classifies', () => {
  it('falls back to UNKNOWN at confidence 0 when AI is unavailable', async () => {
    const result = await suggestFailureCause(baseInput(), { client: null });
    expect(result.source).toBe('FALLBACK');
    expect(result.value.suggestedRootCause).toBe('UNKNOWN');
    expect(result.value.confidence).toBe(0);
  });

  it('the suggestion is always one of the classifier’s own categories', async () => {
    const suggestion: FailureSuggestion = {
      suggestedRootCause: 'ISSUER_TEMPORARY_FAILURE',
      confidence: 0.71,
      explanation: 'Description mentions an upstream timeout pattern consistent with issuer failures.',
    };
    const result = await suggestFailureCause(baseInput(), { client: successClient(suggestion) });
    expect(ALLOWED_ROOT_CAUSES).toContain(result.value.suggestedRootCause);
  });
});

describe('suggestFailureCause — AI failure handling (Phase 12 §29)', () => {
  const kinds = ['TIMEOUT', 'INVALID_JSON', 'INVALID_ENUM', 'PROVIDER_ERROR', 'RATE_LIMIT'] as const;

  it.each(kinds)('%s falls back to UNKNOWN, never a fabricated category', async (kind) => {
    const result = await suggestFailureCause(baseInput(), { client: throwingClient(kind) });
    expect(result.source).toBe('FALLBACK');
    expect(result.value.suggestedRootCause).toBe('UNKNOWN');
  });
});

describe('suggestFailureCause — result shape never implies an automatic decision', () => {
  it('the AI result carries no action, schedule, or execution field of any kind', async () => {
    const suggestion: FailureSuggestion = {
      suggestedRootCause: 'CUSTOMER_FUNDS_LOW',
      confidence: 0.8,
      explanation: 'Balance-related decline language.',
    };
    const result = await suggestFailureCause(baseInput(), { client: successClient(suggestion) });
    expect(result.value).not.toHaveProperty('action');
    expect(result.value).not.toHaveProperty('scheduledFor');
    expect(result.value).not.toHaveProperty('autoClassify');
  });
});
