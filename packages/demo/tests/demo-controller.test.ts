import { describe, expect, it } from 'vitest';
import { createDemoController } from '../src/demo-controller';
import {
  DEMO_AMOUNT_AT_RISK_MINOR,
  DEMO_CUSTOMERS,
  DEMO_ID_PREFIX,
  DEMO_PAYMENTS,
  demoCauseDistribution,
} from '../src/demo-scenarios';
import { DEMO_DATASET_VERSION, DEMO_SEED, DEMO_STAGES, MAX_DEMO_EVENTS } from '../src/demo-state';

function controller() {
  let t = 1_700_000_000_000;
  return createDemoController({ now: () => (t += 1000) });
}

describe('demo controller — stage machine', () => {
  it('starts at READY with no demo id', () => {
    const c = controller();
    expect(c.getState().stage).toBe('READY');
    expect(c.getState().demoId).toBeNull();
  });

  it('refuses to advance before the demo is started', () => {
    const c = controller();
    const result = c.advance();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not been started/i);
    expect(c.getState().stage).toBe('READY');
  });

  it('walks every stage exactly once, in order, and then stops', () => {
    const c = controller();
    c.start('demo_001');

    const visited = [c.getState().stage];
    for (let i = 0; i < DEMO_STAGES.length + 5; i += 1) {
      const result = c.advance();
      if (!result.ok) break;
      visited.push(result.to);
    }

    expect(visited).toEqual([...DEMO_STAGES]);
    expect(c.getState().stage).toBe('COMPLETE');
    expect(c.advance().ok).toBe(false);
  });

  it('never skips a stage', () => {
    const c = controller();
    c.start('demo_001');
    const first = c.advance();
    expect(first.from).toBe('READY');
    expect(first.to).toBe('FAILURES');
  });

  it('start is idempotent for the same demo id', () => {
    const c = controller();
    c.start('demo_001');
    c.advance();
    const before = c.getState().stage;
    c.start('demo_001');
    expect(c.getState().stage).toBe(before);
  });

  it('starting a new demo id resets the run', () => {
    const c = controller();
    c.start('demo_001');
    c.advance();
    c.start('demo_002');
    expect(c.getState().stage).toBe('READY');
    expect(c.getState().demoId).toBe('demo_002');
  });

  it('reset returns to a clean READY state', () => {
    const c = controller();
    c.start('demo_001');
    c.advance();
    c.record('X', 'y');
    const state = c.reset();
    expect(state.stage).toBe('READY');
    expect(state.demoId).toBeNull();
    expect(state.events).toHaveLength(0);
  });
});

describe('demo controller — event log', () => {
  it('records events tagged with the current stage', () => {
    const c = controller();
    c.start('demo_001');
    c.advance();
    const event = c.record('FAILURE_INGESTED', 'demo_pay_1001 failed');
    expect(event.stage).toBe('FAILURES');
    expect(event.type).toBe('FAILURE_INGESTED');
  });

  it('is bounded — a long demo cannot grow the feed without limit', () => {
    const c = controller();
    c.start('demo_001');
    for (let i = 0; i < MAX_DEMO_EVENTS + 50; i += 1) {
      c.record('NOISE', `event ${i}`);
    }
    expect(c.getState().events.length).toBe(MAX_DEMO_EVENTS);
    // The most recent event survives; the oldest were dropped.
    expect(c.getState().events.at(-1)?.message).toBe(`event ${MAX_DEMO_EVENTS + 49}`);
  });
});

describe('demo controller — seed verification (Phase 13 §27)', () => {
  it('passes on the expected seed + dataset', () => {
    const c = controller();
    expect(c.verifySeed(DEMO_SEED, DEMO_DATASET_VERSION)).toBeNull();
  });

  it('reports a configuration error on a different seed', () => {
    const c = controller();
    const error = c.verifySeed(12345, DEMO_DATASET_VERSION);
    expect(error).not.toBeNull();
    expect(error?.expectedSeed).toBe(DEMO_SEED);
    expect(error?.actualSeed).toBe(12345);
  });

  it('reports a configuration error on a different dataset version', () => {
    const c = controller();
    expect(c.verifySeed(DEMO_SEED, 'failures-v2')).not.toBeNull();
  });
});

describe('demo dataset', () => {
  it('is small enough to read on a projector', () => {
    expect(DEMO_PAYMENTS.length).toBeGreaterThanOrEqual(12);
    expect(DEMO_PAYMENTS.length).toBeLessThanOrEqual(20);
  });

  it('every id is namespaced so reset can never touch development data', () => {
    for (const c of DEMO_CUSTOMERS) expect(c.id.startsWith(DEMO_ID_PREFIX)).toBe(true);
    for (const p of DEMO_PAYMENTS) expect(p.id.startsWith(DEMO_ID_PREFIX)).toBe(true);
  });

  it('every payment points at a demo customer that exists', () => {
    const ids = new Set(DEMO_CUSTOMERS.map((c) => c.id));
    for (const p of DEMO_PAYMENTS) expect(ids.has(p.customerId)).toBe(true);
  });

  it('covers every playbook the policy engine has (Phase 13 §5)', () => {
    const dist = demoCauseDistribution();
    expect(dist.CUSTOMER_FUNDS_LOW).toBeGreaterThanOrEqual(1);
    expect(dist.ISSUER_TEMPORARY_FAILURE).toBeGreaterThanOrEqual(2);
    expect(dist.GATEWAY_FAILURE).toBeGreaterThanOrEqual(2);
    expect(dist.CUSTOMER_AUTH_FAILURE).toBeGreaterThanOrEqual(1);
    expect(dist.CUSTOMER_ABANDONMENT).toBeGreaterThanOrEqual(1);
    expect(dist.PAYMENT_METHOD_INVALID).toBeGreaterThanOrEqual(1);
    expect(dist.MANDATE_INVALID).toBeGreaterThanOrEqual(1);
    expect(dist.UNKNOWN).toBe(1);
  });

  it('has a stable headline amount at risk', () => {
    expect(DEMO_AMOUNT_AT_RISK_MINOR).toBe(3_840_000); // ₹38,400.00
  });

  it('has unique payment ids', () => {
    expect(new Set(DEMO_PAYMENTS.map((p) => p.id)).size).toBe(DEMO_PAYMENTS.length);
  });
});
