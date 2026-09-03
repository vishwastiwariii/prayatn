import { describe, expect, it } from 'vitest';
import { decideDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';

describe('decideRecovery', () => {
  it('404s when the failure is unknown', async () => {
    const world = makeWorld();
    const r = await decideRecovery('nope', decideDepsFor(world));
    expect(r.status).toBe('FAILURE_NOT_FOUND');
  });

  it('409s (NOT_CLASSIFIED) when the failure has no classification', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world, { classification: null });
    const r = await decideRecovery(failureId, decideDepsFor(world));
    expect(r.status).toBe('NOT_CLASSIFIED');
    expect(world.actions.size).toBe(0);
  });

  it('persists ONE approved RETRY action for an issuer-temporary failure', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world); // ISSUER_TEMPORARY_FAILURE
    const r = await decideRecovery(failureId, decideDepsFor(world));

    expect(r.status).toBe('DECIDED');
    if (r.status !== 'DECIDED') return;
    expect(r.decision.action).toBe('RETRY');
    expect(r.decision.delayMinutes).toBe(18);
    expect(r.action.action).toBe('RETRY');
    expect(r.action.status).toBe('PENDING');
    expect(r.action.attemptNumber).toBe(2); // payment.attemptCount(1) + 1
    expect(r.action.maxAttempts).toBe(3);
    expect(r.action.idempotencyKey).toMatch(/^decide:/);
    expect(world.actions.size).toBe(1);
    expect(world.audits.some((a) => a.eventType === 'POLICY_DECISION')).toBe(true);
  });

  it('is idempotent: a second call returns the same action, no new row', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world);
    const first = await decideRecovery(failureId, decideDepsFor(world));
    const second = await decideRecovery(failureId, decideDepsFor(world));
    expect(second.status).toBe('DUPLICATE');
    if (first.status !== 'DECIDED' || second.status !== 'DUPLICATE') return;
    expect(second.action.id).toBe(first.action.id);
    expect(world.actions.size).toBe(1);
    expect(world.audits.filter((a) => a.eventType === 'POLICY_DECISION')).toHaveLength(1);
  });

  it('a concurrent unique-violation is resolved to DUPLICATE', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world);
    const deps = decideDepsFor(world);
    const [a, b] = await Promise.all([
      decideRecovery(failureId, deps),
      decideRecovery(failureId, deps),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['DECIDED', 'DUPLICATE']);
    expect(world.actions.size).toBe(1);
  });

  it('MANDATE_INVALID -> HARD_STOP action, persisted CANCELLED, payment HARD_STOPPED', async () => {
    const world = makeWorld();
    const { failureId, paymentId } = seedFailure(world, {
      failure: { reason: 'mandate_revoked', source: 'BUSINESS' },
      classification: { cause: 'MANDATE_INVALID', confidence: 0.99, ruleId: 'MANDATE_REVOKED_001' },
      payment: { method: 'MANDATE' },
    });
    const r = await decideRecovery(failureId, decideDepsFor(world));
    expect(r.status).toBe('DECIDED');
    if (r.status !== 'DECIDED') return;
    expect(r.decision.action).toBe('HARD_STOP');
    expect(r.decision.terminal).toBe(true);
    expect(r.action.status).toBe('CANCELLED');
    expect(world.payments.get(paymentId)?.status).toBe('HARD_STOPPED');
  });

  it('UNKNOWN -> HUMAN_REVIEW action, persisted BLOCKED', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world, {
      classification: { cause: 'UNKNOWN', confidence: 0.2, ruleId: null },
    });
    const r = await decideRecovery(failureId, decideDepsFor(world));
    if (r.status !== 'DECIDED') throw new Error('expected DECIDED');
    expect(r.decision.action).toBe('HUMAN_REVIEW');
    expect(r.action.status).toBe('BLOCKED');
  });
});
