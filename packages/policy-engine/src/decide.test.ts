import type { RootCause } from '@recovery-desk/domain';
import { describe, expect, it } from 'vitest';
import { NOW, withCause } from './_fixtures';
import { decide, resolveConstraints, toRecoveryDecision } from './decide';

const ALL_CAUSES: RootCause[] = [
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
];

describe('determinism', () => {
  it('decide() is pure: 200 runs per cause give a deep-equal decision', () => {
    for (const cause of ALL_CAUSES) {
      const input = withCause(cause);
      const first = JSON.stringify(decide(input));
      for (let i = 0; i < 200; i += 1) {
        expect(JSON.stringify(decide(input))).toBe(first);
      }
    }
  });
});

describe('every decision is internally coherent', () => {
  it.each(ALL_CAUSES)('%s: action / permitted / terminal agree', (cause) => {
    const d = decide(withCause(cause));

    // action is one of the six
    expect(['RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE', 'HARD_STOP', 'HUMAN_REVIEW']).toContain(
      d.action,
    );

    if (d.action === 'HARD_STOP') {
      expect(d.terminal).toBe(true);
      expect(d.permitted).toMatchObject({
        retry: false,
        scheduleRetry: false,
        messageCustomer: false,
      });
      expect(d.nextEligibleAt).toBeNull();
      expect(d.delayMinutes).toBeNull();
    }
    if (d.action === 'HUMAN_REVIEW') {
      expect(d.permitted.autoExecute).toBe(false);
      expect(d.permitted.retry).toBe(false);
    }
    if (d.action === 'RETRY') {
      expect(d.permitted.retry).toBe(true);
      expect(d.delayMinutes).not.toBeNull();
      expect(d.nextEligibleAt).not.toBeNull();
    }
    if (d.terminal) {
      expect(d.nextEligibleAt).toBeNull();
      expect(d.attemptsRemaining).toBe(0);
    }
    // blockedBy is always a subset of constraintsApplied
    for (const id of d.blockedBy) expect(d.constraintsApplied).toContain(id);
  });
});

describe('the engine decides BOTH the action and what is permitted', () => {
  it('a clean issuer failure: RETRY is permitted and scheduled', () => {
    const d = decide(withCause('ISSUER_TEMPORARY_FAILURE'));
    expect(d).toMatchObject({
      action: 'RETRY',
      intendedAction: 'RETRY',
      delayMinutes: 18,
      maxAttempts: 3,
      attemptsRemaining: 2,
      terminal: false,
      permitted: { retry: true, scheduleRetry: true, autoExecute: true },
      blockedBy: [],
    });
  });

  it('same failure, attempts spent + breaker open: action and permissions both clamp down', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        payment: { id: 'p', method: 'CARD', status: 'FAILED', attemptCount: 3 },
        constraints: { now: NOW, circuitBreaker: 'OPEN' },
      }),
    );
    expect(d.intendedAction).toBe('RETRY');
    expect(d.action).toBe('HUMAN_REVIEW'); // attempt limit is checked before the breaker
    expect(d.permitted.retry).toBe(false);
    expect(d.permitted.autoExecute).toBe(false);
    expect(d.blockedBy).toContain('attempt_limit_reached');
  });
});

describe('toRecoveryDecision (compact Phase 7 shape)', () => {
  it('projects the decision onto { action, cause, reason, delayMinutes?, maxAttempts }', () => {
    const dto = toRecoveryDecision(decide(withCause('ISSUER_TEMPORARY_FAILURE')));
    expect(dto).toMatchObject({
      action: 'RETRY',
      cause: 'ISSUER_TEMPORARY_FAILURE',
      delayMinutes: 18,
      maxAttempts: 3,
    });
    expect(typeof dto.reason).toBe('string');
  });

  it('omits delayMinutes for a HARD_STOP', () => {
    const dto = toRecoveryDecision(decide(withCause('MANDATE_INVALID')));
    expect(dto.action).toBe('HARD_STOP');
    expect(dto.delayMinutes).toBeUndefined();
  });
});

describe('resolveConstraints', () => {
  it('fills defaults from RECOVERY_LIMITS', () => {
    const c = resolveConstraints({ now: NOW });
    expect(c.maxAttempts).toBe(3);
    expect(c.maxMessagesPerDay).toBe(2);
    expect(c.quietHoursStart).toBe(22);
    expect(c.issuerRetryDelayMinutes).toBe(18);
  });

  it('throws on an invalid clock', () => {
    // @ts-expect-error deliberately wrong
    expect(() => resolveConstraints({ now: 'nope' })).toThrow(/valid Date/);
    expect(() => resolveConstraints({ now: new Date('bad') })).toThrow(/valid Date/);
  });
});
