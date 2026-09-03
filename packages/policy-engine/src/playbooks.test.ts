import type { RootCause } from '@recovery-desk/domain';
import { describe, expect, it } from 'vitest';
import { NOW, withCause } from './_fixtures';
import { decide } from './decide';
import { ALL_PLAYBOOKS, PLAYBOOKS } from './playbooks';
import { addMinutes } from './time';

describe('playbook table', () => {
  it('has exactly one playbook per RootCause, keyed by its own cause', () => {
    const causes: RootCause[] = [
      'CUSTOMER_FUNDS_LOW',
      'CUSTOMER_AUTH_FAILURE',
      'CUSTOMER_ABANDONMENT',
      'ISSUER_TEMPORARY_FAILURE',
      'GATEWAY_FAILURE',
      'PAYMENT_METHOD_INVALID',
      'MANDATE_INVALID',
      'UNKNOWN',
    ];
    expect(Object.keys(PLAYBOOKS).sort()).toEqual([...causes].sort());
    for (const cause of causes) {
      expect(PLAYBOOKS[cause].cause).toBe(cause);
    }
    expect(new Set(ALL_PLAYBOOKS.map((p) => p.id)).size).toBe(ALL_PLAYBOOKS.length);
  });
});

describe('CUSTOMER_FUNDS_LOW -> WAIT for the salary window', () => {
  const d = decide(withCause('CUSTOMER_FUNDS_LOW', { customer: { salaryDay: 1 } }));
  it('waits and schedules, but does not retry now', () => {
    expect(d.action).toBe('WAIT');
    expect(d.delayMinutes).toBeGreaterThan(0);
    expect(d.maxAttempts).toBe(3);
    expect(d.permitted.scheduleRetry).toBe(true);
    expect(d.permitted.retry).toBe(false);
    expect(d.terminal).toBe(false);
    expect(d.nextEligibleAt).toEqual(addMinutes(NOW, d.delayMinutes as number));
  });
  it('falls back to a fixed delay when the salary day is unknown', () => {
    const f = decide(withCause('CUSTOMER_FUNDS_LOW', { customer: { salaryDay: null } }));
    expect(f.delayMinutes).toBe(24 * 60);
    expect(f.reason).toMatch(/salary day = unknown/);
  });
});

describe('ISSUER_TEMPORARY_FAILURE -> RETRY after 18 minutes', () => {
  const d = decide(withCause('ISSUER_TEMPORARY_FAILURE'));
  it('retries after the fixed cooldown', () => {
    expect(d.action).toBe('RETRY');
    expect(d.delayMinutes).toBe(18);
    expect(d.maxAttempts).toBe(3);
    expect(d.permitted.retry).toBe(true);
    expect(d.nextEligibleAt).toEqual(addMinutes(NOW, 18));
  });
});

describe('GATEWAY_FAILURE -> WAIT, timing follows the circuit breaker', () => {
  it('CLOSED breaker: short recheck delay', () => {
    const d = decide(
      withCause('GATEWAY_FAILURE', { constraints: { now: NOW, circuitBreaker: 'CLOSED' } }),
    );
    expect(d.action).toBe('WAIT');
    expect(d.delayMinutes).toBe(5);
    expect(d.blockedBy).not.toContain('circuit_breaker_open');
  });
  it('OPEN breaker: waits at least the cooldown and is marked blocked', () => {
    const d = decide(
      withCause('GATEWAY_FAILURE', { constraints: { now: NOW, circuitBreaker: 'OPEN' } }),
    );
    expect(d.action).toBe('WAIT');
    expect(d.delayMinutes).toBeGreaterThanOrEqual(60);
    expect(d.blockedBy).toContain('circuit_breaker_open');
  });
});

describe('CUSTOMER_ABANDONMENT -> MESSAGE (card) / SWITCH_RAIL (UPI)', () => {
  it('card 3DS abandonment -> MESSAGE the customer', () => {
    const d = decide(
      withCause('CUSTOMER_ABANDONMENT', {
        payment: { id: 'p', method: 'CARD', status: 'FAILED', attemptCount: 1 },
      }),
    );
    expect(d.action).toBe('MESSAGE');
    expect(d.requiresCustomerMessage).toBe(true);
    expect(d.permitted.messageCustomer).toBe(true);
  });
  it('UPI collect abandonment -> SWITCH_RAIL', () => {
    const d = decide(
      withCause('CUSTOMER_ABANDONMENT', {
        payment: { id: 'p', method: 'UPI', status: 'FAILED', attemptCount: 1 },
      }),
    );
    expect(d.action).toBe('SWITCH_RAIL');
    expect(d.permitted.switchRail).toBe(true);
  });
  it('UPI, but the rail was already switched -> MESSAGE', () => {
    const d = decide(
      withCause('CUSTOMER_ABANDONMENT', {
        payment: { id: 'p', method: 'UPI', status: 'FAILED', attemptCount: 1 },
        history: { railSwitched: true },
      }),
    );
    expect(d.action).toBe('MESSAGE');
  });
});

describe('CUSTOMER_AUTH_FAILURE -> MESSAGE (no blind retry)', () => {
  const d = decide(withCause('CUSTOMER_AUTH_FAILURE'));
  it('messages the customer and does not permit an automatic retry', () => {
    expect(d.action).toBe('MESSAGE');
    expect(d.permitted.retry).toBe(false);
    expect(d.requiresCustomerMessage).toBe(true);
  });
});

describe('PAYMENT_METHOD_INVALID -> HARD_STOP', () => {
  const d = decide(withCause('PAYMENT_METHOD_INVALID'));
  it('stops permanently with no permissions and no schedule', () => {
    expect(d.action).toBe('HARD_STOP');
    expect(d.terminal).toBe(true);
    expect(d.maxAttempts).toBe(0);
    expect(d.delayMinutes).toBeNull();
    expect(d.nextEligibleAt).toBeNull();
    expect(d.permitted).toMatchObject({
      retry: false,
      scheduleRetry: false,
      messageCustomer: false,
    });
  });
});

describe('MANDATE_INVALID -> HARD_STOP, cancel future retries', () => {
  const d = decide(withCause('MANDATE_INVALID'));
  it('stops permanently and signals cancellation of queued retries', () => {
    expect(d.action).toBe('HARD_STOP');
    expect(d.terminal).toBe(true);
    expect(d.evidence).toContain('cancel_future_retries');
  });
});

describe('UNKNOWN -> HUMAN_REVIEW, never auto-retry', () => {
  const d = decide(withCause('UNKNOWN', { classification: { cause: 'UNKNOWN', confidence: 0.2 } }));
  it('routes to a human and forbids automatic execution', () => {
    expect(d.action).toBe('HUMAN_REVIEW');
    expect(d.requiresHumanReview).toBe(true);
    expect(d.permitted.autoExecute).toBe(false);
    expect(d.permitted.retry).toBe(false);
  });
});
