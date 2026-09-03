import { describe, expect, it } from 'vitest';
import { createSimulator, hash32 } from './index';

describe('mock gateway — determinism', () => {
  it('same input + config -> identical result', () => {
    const a = createSimulator();
    const b = createSimulator();
    const input = { paymentId: 'pay_1', amountMinor: 250000, method: 'CARD', attemptNumber: 2 };
    expect(a.charge(input)).toEqual(b.charge(input));
  });

  it('hash32 is stable', () => {
    expect(hash32('pay_1:2')).toBe(hash32('pay_1:2'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });
});

describe('mock gateway — default recovery behaviour', () => {
  const gw = createSimulator();

  it('attempt 1 fails, attempt 2 (first retry) succeeds', () => {
    const first = gw.charge({ paymentId: 'p', amountMinor: 100, method: 'CARD', attemptNumber: 1 });
    const retry = gw.charge({ paymentId: 'p', amountMinor: 100, method: 'CARD', attemptNumber: 2 });
    expect(first.status).toBe('FAILURE');
    expect(first.amountCapturedMinor).toBe(0);
    expect(retry.status).toBe('SUCCESS');
    expect(retry.amountCapturedMinor).toBe(100);
    expect(retry.latencyMs).toBeGreaterThan(0);
  });
});

describe('mock gateway — config', () => {
  it('scripted outcomes win', () => {
    const gw = createSimulator({ scripted: { p: ['SUCCESS', 'FAILURE'] } });
    expect(
      gw.charge({ paymentId: 'p', amountMinor: 1, method: 'UPI', attemptNumber: 1 }).status,
    ).toBe('SUCCESS');
    expect(
      gw.charge({ paymentId: 'p', amountMinor: 1, method: 'UPI', attemptNumber: 2 }).status,
    ).toBe('FAILURE');
    // beyond the script length -> last entry repeats
    expect(
      gw.charge({ paymentId: 'p', amountMinor: 1, method: 'UPI', attemptNumber: 9 }).status,
    ).toBe('FAILURE');
  });

  it('dead payment ids always fail with dead_instrument', () => {
    const gw = createSimulator({ deadPaymentIds: ['pay_dead'] });
    const r = gw.charge({
      paymentId: 'pay_dead',
      amountMinor: 1,
      method: 'CARD',
      attemptNumber: 5,
    });
    expect(r.status).toBe('FAILURE');
    expect(r.code).toBe('dead_instrument');
  });

  it('forceFailure fails every non-scripted charge', () => {
    const gw = createSimulator({ forceFailure: true });
    expect(
      gw.charge({ paymentId: 'x', amountMinor: 1, method: 'CARD', attemptNumber: 9 }).status,
    ).toBe('FAILURE');
  });

  it('recoversOnAttempt is tunable', () => {
    const gw = createSimulator({ recoversOnAttempt: 3 });
    expect(
      gw.charge({ paymentId: 'x', amountMinor: 1, method: 'CARD', attemptNumber: 2 }).status,
    ).toBe('FAILURE');
    expect(
      gw.charge({ paymentId: 'x', amountMinor: 1, method: 'CARD', attemptNumber: 3 }).status,
    ).toBe('SUCCESS');
  });
});

describe('mock gateway — sendMessage', () => {
  it('always sends, deterministically', () => {
    const gw = createSimulator();
    const r1 = gw.sendMessage({ paymentId: 'p', cause: 'CUSTOMER_ABANDONMENT', channel: 'SMS' });
    const r2 = gw.sendMessage({ paymentId: 'p', cause: 'CUSTOMER_ABANDONMENT', channel: 'SMS' });
    expect(r1.status).toBe('SENT');
    expect(r1).toEqual(r2);
  });
});
