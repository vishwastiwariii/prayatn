import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { type AttemptContext, type ScenarioKind, buildTruth, evaluateAttempt } from './scenarios';

const T0 = new Date('2026-09-10T12:00:00Z').getTime();

function ctx(over: Partial<AttemptContext> = {}): AttemptContext {
  return {
    attemptNumber: 2,
    atMs: T0,
    originatedAtMs: T0,
    messagesSent: 0,
    railSwitched: false,
    ...over,
  };
}

const ALL_KINDS: ScenarioKind[] = [
  'ISSUER_TEMPORARY',
  'GATEWAY_5XX',
  'FUNDS_LOW',
  'AUTH_FAILURE',
  'ABANDONMENT',
  'INVALID_METHOD',
  'MANDATE_REVOKED',
  'UNKNOWN',
];

describe('buildTruth — every scenario produces a public failure descriptor', () => {
  it.each(ALL_KINDS)('%s', (kind) => {
    const t = buildTruth(kind, 'CARD', T0, 1, createRng(`${kind}-1`));
    expect(t.kind).toBe(kind);
    expect(t.publicFailure.reason).toBeTruthy();
    expect(['CUSTOMER', 'BANK', 'GATEWAY', 'BUSINESS']).toContain(t.publicFailure.source);
  });

  it('all 8 kinds are covered', () => {
    expect(new Set(ALL_KINDS).size).toBe(8);
  });
});

describe('evaluateAttempt — time-resolving scenarios', () => {
  it('ISSUER_TEMPORARY fails before the outage clears, succeeds after', () => {
    const t = {
      kind: 'ISSUER_TEMPORARY' as const,
      publicFailure: buildTruth('ISSUER_TEMPORARY', 'CARD', T0, 1, createRng('x')).publicFailure,
      resolvesAtMs: T0 + 20 * 60_000,
    };
    expect(evaluateAttempt(t, ctx({ atMs: T0 + 5 * 60_000 })).status).toBe('FAILURE');
    expect(evaluateAttempt(t, ctx({ atMs: T0 + 20 * 60_000 })).status).toBe('SUCCESS');
    expect(evaluateAttempt(t, ctx({ atMs: T0 + 25 * 60_000 })).status).toBe('SUCCESS');
  });

  it('FUNDS_LOW is time-based the same way', () => {
    const base = buildTruth('FUNDS_LOW', 'CARD', T0, 1, createRng('f'));
    expect(base.resolvesAtMs).toBeGreaterThan(T0);
    expect(evaluateAttempt(base, ctx({ atMs: T0 })).status).toBe('FAILURE');
    expect(evaluateAttempt(base, ctx({ atMs: (base.resolvesAtMs ?? 0) + 1 })).status).toBe(
      'SUCCESS',
    );
  });
});

describe('evaluateAttempt — nudge scenarios', () => {
  it('AUTH_FAILURE: blind retry fails; succeeds only after a message when the customer cooperates', () => {
    const coop = {
      kind: 'AUTH_FAILURE' as const,
      publicFailure: buildTruth('AUTH_FAILURE', 'CARD', T0, 1, createRng('a')).publicFailure,
      needsNudge: true,
      customerCooperates: true,
    };
    const noCoop = { ...coop, customerCooperates: false };
    expect(evaluateAttempt(coop, ctx({ messagesSent: 0 })).status).toBe('FAILURE');
    expect(evaluateAttempt(coop, ctx({ messagesSent: 1 })).status).toBe('SUCCESS');
    expect(evaluateAttempt(noCoop, ctx({ messagesSent: 1 })).status).toBe('FAILURE');
  });

  it('ABANDONMENT: a rail switch also counts as the nudge', () => {
    const t = {
      kind: 'ABANDONMENT' as const,
      publicFailure: buildTruth('ABANDONMENT', 'UPI', T0, 1, createRng('b')).publicFailure,
      needsNudge: true,
      customerCooperates: true,
    };
    expect(evaluateAttempt(t, ctx({ railSwitched: false })).status).toBe('FAILURE');
    expect(evaluateAttempt(t, ctx({ railSwitched: true })).status).toBe('SUCCESS');
  });
});

describe('evaluateAttempt — permanent scenarios never succeed', () => {
  it.each(['INVALID_METHOD', 'MANDATE_REVOKED', 'UNKNOWN'] as const)('%s', (kind) => {
    const t = buildTruth(kind, 'CARD', T0, 1, createRng(kind));
    expect(t.permanent).toBe(true);
    for (const at of [T0, T0 + 1e9, T0 + 1e12]) {
      expect(
        evaluateAttempt(t, ctx({ atMs: at, messagesSent: 5, railSwitched: true })).status,
      ).toBe('FAILURE');
    }
  });
});
