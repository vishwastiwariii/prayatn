import { describe, expect, it } from 'vitest';
import { createSimulator } from './index';

const ORIGIN = Date.UTC(2026, 8, 4, 10, 0, 0); // 2026-09-04T10:00:00Z

const stormConfig = {
  enabled: true,
  originMs: ORIGIN,
  startMinute: 60,
  durationMinutes: 10,
  failureRate: 1,
  code: '503',
};

describe('mock gateway — result kinds', () => {
  const gw = createSimulator();
  it('labels a normal decline PAYMENT_FAILURE, not GATEWAY_FAILURE', () => {
    const r = gw.charge({ paymentId: 'p', amountMinor: 100, method: 'CARD', attemptNumber: 1 });
    expect(r.status).toBe('FAILURE');
    expect(r.kind).toBe('PAYMENT_FAILURE');
  });
  it('labels a success SUCCESS', () => {
    const r = gw.charge({ paymentId: 'p', amountMinor: 100, method: 'CARD', attemptNumber: 2 });
    expect(r.kind).toBe('SUCCESS');
  });
});

describe('mock gateway — deterministic gateway storm', () => {
  const gw = createSimulator({ seed: 20260904, gatewayStorm: stormConfig, recoversOnAttempt: 1 });
  const at = (minute: number) => ORIGIN + minute * 60_000;

  it('is healthy before the storm window (minute 0..59)', () => {
    const r = gw.charge({
      paymentId: 'x',
      amountMinor: 100,
      method: 'CARD',
      attemptNumber: 1,
      atMs: at(30),
    });
    expect(r.kind).toBe('SUCCESS');
  });

  it('returns GATEWAY_FAILURE (503) during the storm window (minute 60..69)', () => {
    for (const m of [60, 62, 65, 69]) {
      const r = gw.charge({
        paymentId: 'x',
        amountMinor: 100,
        method: 'CARD',
        attemptNumber: 1,
        atMs: at(m),
      });
      expect(r.kind).toBe('GATEWAY_FAILURE');
      expect(r.code).toBe('503');
      expect(r.status).toBe('FAILURE');
      expect(r.amountCapturedMinor).toBe(0);
    }
  });

  it('recovers after the storm window (minute 70+)', () => {
    const r = gw.charge({
      paymentId: 'x',
      amountMinor: 100,
      method: 'CARD',
      attemptNumber: 1,
      atMs: at(75),
    });
    expect(r.kind).toBe('SUCCESS');
  });

  it('is deterministic from the seed', () => {
    const a = createSimulator({ seed: 1, gatewayStorm: stormConfig });
    const b = createSimulator({ seed: 1, gatewayStorm: stormConfig });
    const input = {
      paymentId: 'y',
      amountMinor: 100,
      method: 'UPI',
      attemptNumber: 1,
      atMs: at(63),
    };
    expect(a.charge(input)).toEqual(b.charge(input));
  });

  it('a partial failure rate only fails a deterministic subset', () => {
    const partial = createSimulator({
      seed: 7,
      gatewayStorm: { ...stormConfig, failureRate: 0.5 },
    });
    let failures = 0;
    for (let i = 0; i < 200; i += 1) {
      const r = partial.charge({
        paymentId: `pay_${i}`,
        amountMinor: 100,
        method: 'CARD',
        attemptNumber: 1,
        atMs: at(63),
      });
      if (r.kind === 'GATEWAY_FAILURE') failures += 1;
    }
    expect(failures).toBeGreaterThan(70);
    expect(failures).toBeLessThan(130);
  });

  it('describeConfig exposes the storm window (no hidden tuning)', () => {
    const v = gw.describeConfig();
    expect(v.seed).toBe(20260904);
    expect(v.gatewayStorm).toMatchObject({
      startMinute: 60,
      durationMinutes: 10,
      failureRate: 1,
      startsAtMs: at(60),
      endsAtMs: at(70),
    });
  });
});
