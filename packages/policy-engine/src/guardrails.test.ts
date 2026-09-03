import { describe, expect, it } from 'vitest';
import { NOW, withCause } from './_fixtures';
import { decide } from './decide';

describe('guardrail: kill_switch_engaged (wins over everything)', () => {
  it('turns any playbook into a terminal HARD_STOP', () => {
    for (const cause of [
      'ISSUER_TEMPORARY_FAILURE',
      'CUSTOMER_FUNDS_LOW',
      'CUSTOMER_ABANDONMENT',
    ] as const) {
      const d = decide(withCause(cause, { constraints: { now: NOW, killSwitchEngaged: true } }));
      expect(d.action).toBe('HARD_STOP');
      expect(d.terminal).toBe(true);
      expect(d.blockedBy).toEqual(['kill_switch_engaged']);
      expect(d.permitted.autoExecute).toBe(true); // the worker may perform the stop
      expect(d.permitted.retry).toBe(false);
    }
  });
});

describe('guardrail: mandate_revoked history flag', () => {
  it('forces a terminal HARD_STOP even for a retryable cause', () => {
    const d = decide(withCause('ISSUER_TEMPORARY_FAILURE', { history: { mandateRevoked: true } }));
    expect(d.action).toBe('HARD_STOP');
    expect(d.terminal).toBe(true);
    expect(d.blockedBy).toEqual(['mandate_revoked']);
  });
});

describe('guardrail: payment_already_resolved', () => {
  it('HARD_STOPs when the payment already SUCCEEDED', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        payment: { id: 'p', method: 'CARD', status: 'SUCCEEDED', attemptCount: 2 },
      }),
    );
    expect(d.action).toBe('HARD_STOP');
    expect(d.blockedBy).toEqual(['payment_already_resolved']);
  });
});

describe('guardrail: classification_low_confidence', () => {
  it('escalates a shaky diagnosis to HUMAN_REVIEW instead of acting', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        classification: { cause: 'ISSUER_TEMPORARY_FAILURE', confidence: 0.4 },
      }),
    );
    expect(d.intendedAction).toBe('RETRY');
    expect(d.action).toBe('HUMAN_REVIEW');
    expect(d.requiresHumanReview).toBe(true);
    expect(d.permitted.autoExecute).toBe(false);
    expect(d.blockedBy).toContain('classification_low_confidence');
  });
});

describe('guardrail: attempt_limit_reached', () => {
  it('escalates to HUMAN_REVIEW once automated attempts are exhausted', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        payment: { id: 'p', method: 'CARD', status: 'FAILED', attemptCount: 3 },
      }),
    );
    expect(d.intendedAction).toBe('RETRY');
    expect(d.action).toBe('HUMAN_REVIEW');
    expect(d.attemptsRemaining).toBe(0);
    expect(d.permitted.retry).toBe(false);
    expect(d.blockedBy).toContain('attempt_limit_reached');
  });

  it('still allows a retry when attempts remain', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        payment: { id: 'p', method: 'CARD', status: 'FAILED', attemptCount: 1 },
      }),
    );
    expect(d.action).toBe('RETRY');
    expect(d.attemptsRemaining).toBe(2);
    expect(d.blockedBy).not.toContain('attempt_limit_reached');
  });
});

describe('guardrail: circuit_breaker_open', () => {
  it('forces a RETRY playbook into a WAIT behind the cooldown', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', { constraints: { now: NOW, circuitBreaker: 'OPEN' } }),
    );
    expect(d.intendedAction).toBe('RETRY');
    expect(d.action).toBe('WAIT');
    expect(d.delayMinutes).toBeGreaterThanOrEqual(60);
    expect(d.permitted.retry).toBe(false);
    expect(d.permitted.scheduleRetry).toBe(true);
    expect(d.blockedBy).toContain('circuit_breaker_open');
  });

  it('HALF_OPEN is noted but not blocking', () => {
    const d = decide(
      withCause('ISSUER_TEMPORARY_FAILURE', {
        constraints: { now: NOW, circuitBreaker: 'HALF_OPEN' },
      }),
    );
    expect(d.action).toBe('RETRY');
    expect(d.constraintsApplied).toContain('circuit_breaker_half_open');
    expect(d.blockedBy).not.toContain('circuit_breaker_half_open');
  });
});

describe('guardrail: message_daily_limit_reached', () => {
  it('defers the message when the contact ceiling is hit', () => {
    const d = decide(
      withCause('CUSTOMER_AUTH_FAILURE', {
        history: { messagesSentInWindow: 2 },
      }),
    );
    expect(d.intendedAction).toBe('MESSAGE');
    expect(d.action).toBe('WAIT');
    expect(d.permitted.messageCustomer).toBe(false);
    expect(d.requiresCustomerMessage).toBe(true);
    expect(d.blockedBy).toContain('message_daily_limit_reached');
    expect(d.nextEligibleAt).not.toBeNull();
  });
});

describe('guardrail: quiet_hours', () => {
  it('defers (does not cancel) a message sent inside quiet hours', () => {
    const lateNight = new Date('2026-09-10T23:30:00.000Z');
    const d = decide(withCause('CUSTOMER_AUTH_FAILURE', { constraints: { now: lateNight } }));
    expect(d.action).toBe('MESSAGE');
    expect(d.permitted.messageCustomer).toBe(true);
    expect(d.blockedBy).toContain('quiet_hours');
    // next 08:00 UTC boundary
    expect(d.nextEligibleAt?.getUTCHours()).toBe(8);
    expect(d.nextEligibleAt?.getTime()).toBeGreaterThan(lateNight.getTime());
  });

  it('sends immediately outside quiet hours', () => {
    const d = decide(withCause('CUSTOMER_AUTH_FAILURE', { constraints: { now: NOW } }));
    expect(d.action).toBe('MESSAGE');
    expect(d.blockedBy).not.toContain('quiet_hours');
    expect(d.nextEligibleAt).toEqual(NOW);
  });
});
