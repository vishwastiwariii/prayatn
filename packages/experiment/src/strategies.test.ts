import {
  type SimulatedDataset,
  type SimulatedPayment,
  type SimulationTruth,
  createHiddenStateSimulator,
} from '@recovery-desk/simulator';
import { describe, expect, it } from 'vitest';
import { runPayment } from './env';
import { naiveStrategy, recoveryDeskStrategy } from './strategies';

const ORIGIN = new Date('2026-09-10T12:00:00Z').getTime();

function makePayment(over: Partial<SimulatedPayment> = {}): SimulatedPayment {
  return {
    id: 'sim_pay_0001',
    customerId: 'sim_cust_0001',
    method: 'CARD',
    amountMinor: 250_000,
    currency: 'INR',
    salaryDay: 1,
    originatedAtMs: ORIGIN,
    ...over,
  };
}

function simFor(payment: SimulatedPayment, truth: SimulationTruth) {
  const dataset: SimulatedDataset = {
    seed: 1,
    payments: [payment],
    truth: new Map([[payment.id, truth]]),
    methodBreakdown: { CARD: 1, UPI: 0, NETBANKING: 0, MANDATE: 0, WALLET: 0 },
    scenarioBreakdown: {
      ISSUER_TEMPORARY: 0,
      GATEWAY_5XX: 0,
      FUNDS_LOW: 0,
      AUTH_FAILURE: 0,
      ABANDONMENT: 0,
      INVALID_METHOD: 0,
      MANDATE_REVOKED: 0,
      UNKNOWN: 0,
    },
  };
  return createHiddenStateSimulator(dataset);
}

const ISSUER_FAIL: SimulationTruth['publicFailure'] = {
  code: 'GATEWAY_ERROR',
  reason: 'issuer_timeout',
  source: 'BANK',
  step: 'AUTHORIZATION',
  description: 'Issuer did not respond',
};

describe('naive baseline', () => {
  it('never messages, makes at most 4 attempts (original + 3), stops EXHAUSTED', () => {
    const p = makePayment();
    const sim = simFor(p, {
      kind: 'ISSUER_TEMPORARY',
      publicFailure: ISSUER_FAIL,
      resolvesAtMs: ORIGIN + 60 * 60_000,
    });
    const r = runPayment(sim, p, naiveStrategy);
    expect(r.recovered).toBe(false);
    expect(r.attemptsMade).toBe(4);
    expect(r.messagesSent).toBe(0);
    expect(r.endedBy).toBe('EXHAUSTED');
  });

  it('recovers a sub-second blip and stops early', () => {
    const p = makePayment();
    const sim = simFor(p, {
      kind: 'ISSUER_TEMPORARY',
      publicFailure: ISSUER_FAIL,
      resolvesAtMs: ORIGIN + 900,
    });
    const r = runPayment(sim, p, naiveStrategy);
    expect(r.recovered).toBe(true);
    expect(r.attemptsMade).toBeLessThanOrEqual(4);
    expect(r.amountRecoveredMinor).toBe(250_000);
  });
});

describe('recovery desk strategy (real classifier + policy engine)', () => {
  it('MANDATE_REVOKED -> HARD_STOP after the first classification, no retry', () => {
    const p = makePayment({ method: 'MANDATE' });
    const sim = simFor(p, {
      kind: 'MANDATE_REVOKED',
      publicFailure: {
        code: 'BAD_REQUEST_ERROR',
        reason: 'mandate_revoked',
        source: 'BUSINESS',
        step: 'AUTHORIZATION',
        description: 'mandate revoked',
      },
      permanent: true,
    });
    const r = runPayment(sim, p, recoveryDeskStrategy);
    expect(r.endedBy).toBe('HARD_STOP');
    expect(r.attemptsMade).toBe(1);
    expect(r.recovered).toBe(false);
  });

  it('UNKNOWN -> HUMAN_REVIEW, no retry', () => {
    const p = makePayment({ method: 'NETBANKING' });
    const sim = simFor(p, {
      kind: 'UNKNOWN',
      publicFailure: {
        code: 'GATEWAY_ERROR',
        reason: 'authorization_response_mismatch',
        source: 'GATEWAY',
        step: 'AUTHORIZATION',
        description: 'mismatch',
      },
      permanent: true,
    });
    const r = runPayment(sim, p, recoveryDeskStrategy);
    expect(r.endedBy).toBe('HUMAN_REVIEW');
    expect(r.attemptsMade).toBe(1);
  });

  it('ISSUER outage that clears within ~36 min -> recovered via timed retries', () => {
    const p = makePayment();
    const sim = simFor(p, {
      kind: 'ISSUER_TEMPORARY',
      publicFailure: ISSUER_FAIL,
      resolvesAtMs: ORIGIN + 25 * 60_000,
    });
    const r = runPayment(sim, p, recoveryDeskStrategy);
    expect(r.recovered).toBe(true);
    expect(r.attemptsMade).toBeLessThanOrEqual(3); // policy ceiling
    expect(r.minutesElapsed).toBeGreaterThanOrEqual(25);
  });

  it('AUTH_FAILURE with a cooperating customer -> message then recover', () => {
    const p = makePayment();
    const sim = simFor(p, {
      kind: 'AUTH_FAILURE',
      publicFailure: {
        code: 'BAD_REQUEST_ERROR',
        reason: 'authentication_failed',
        source: 'CUSTOMER',
        step: 'AUTHENTICATION',
        description: 'wrong otp',
      },
      needsNudge: true,
      customerCooperates: true,
    });
    const r = runPayment(sim, p, recoveryDeskStrategy);
    expect(r.messagesSent).toBeGreaterThanOrEqual(1);
    expect(r.recovered).toBe(true);
  });

  it('AUTH_FAILURE with a non-cooperating customer -> messages, never recovers', () => {
    const p = makePayment();
    const sim = simFor(p, {
      kind: 'AUTH_FAILURE',
      publicFailure: {
        code: 'BAD_REQUEST_ERROR',
        reason: 'authentication_failed',
        source: 'CUSTOMER',
        step: 'AUTHENTICATION',
        description: 'wrong otp',
      },
      needsNudge: true,
      customerCooperates: false,
    });
    const r = runPayment(sim, p, recoveryDeskStrategy);
    expect(r.recovered).toBe(false);
    expect(r.messagesSent).toBeLessThanOrEqual(2);
  });
});
