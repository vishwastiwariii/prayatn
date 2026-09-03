/* Test fixtures (not a spec file). */
import type { PolicyClassification, PolicyInput } from './types';

export const NOW = new Date('2026-09-10T12:00:00.000Z');

/** A funds-low classification on a card payment that has failed once. */
export function baseInput(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    payment: {
      id: 'pay_1',
      method: 'CARD',
      status: 'FAILED',
      attemptCount: 1,
      amountMinor: 250000,
      currency: 'INR',
      ...(over.payment ?? {}),
    },
    failure: {
      id: 'fail_1',
      reason: 'insufficient_funds',
      source: 'BANK',
      step: 'AUTHORIZATION',
      occurredAt: NOW,
      ...(over.failure ?? {}),
    },
    classification: {
      cause: 'CUSTOMER_FUNDS_LOW',
      confidence: 0.98,
      ruleId: 'FUNDS_LOW_001',
      ...(over.classification ?? {}),
    },
    customer: {
      salaryDay: 1,
      balanceState: 'LOW',
      preferredLanguage: 'EN',
      ...(over.customer ?? {}),
    },
    history: over.history,
    constraints: { now: NOW, ...(over.constraints ?? {}) },
  };
}

export function withCause(
  cause: PolicyClassification['cause'],
  over: Partial<PolicyInput> = {},
): PolicyInput {
  return baseInput({
    ...over,
    classification: {
      cause,
      confidence: 0.95,
      ruleId: `RULE_${cause}`,
      ...(over.classification ?? {}),
    },
  });
}
