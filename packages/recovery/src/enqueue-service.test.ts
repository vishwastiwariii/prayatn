import { describe, expect, it, vi } from 'vitest';
import { decideDepsFor, enqueueDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';
import { enqueueRecoveryAction } from './enqueue-service';

async function decidedAction(world = makeWorld()) {
  const { failureId } = seedFailure(world);
  const r = await decideRecovery(failureId, decideDepsFor(world));
  if (r.status !== 'DECIDED') throw new Error('setup');
  return { world, action: r.action };
}

describe('enqueueRecoveryAction', () => {
  it('404s for an unknown action', async () => {
    const r = await enqueueRecoveryAction('nope', enqueueDepsFor(makeWorld()));
    expect(r.status).toBe('NOT_FOUND');
  });

  it('enqueues a PENDING RETRY action, delay derived from scheduledFor', async () => {
    const { world, action } = await decidedAction();
    const onEnqueue = vi.fn();
    // scheduledFor is now + 18 min; fixed clock in fakes is 12:00Z
    const r = await enqueueRecoveryAction(action.id, enqueueDepsFor(world, { onEnqueue }));
    expect(r.status).toBe('ENQUEUED');
    if (r.status !== 'ENQUEUED') return;
    expect(r.jobId).toBe(action.id);
    expect(r.delayMs).toBe(18 * 60_000);
    expect(onEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: action.id, attemptNumber: 2 }),
      18 * 60_000,
    );
    expect(world.actions.get(action.id)?.status).toBe('SCHEDULED');
    expect(world.payments.get(action.paymentId)?.recoveryStatus).toBe('SCHEDULED');
    expect(world.audits.some((a) => a.eventType === 'RECOVERY_ENQUEUED')).toBe(true);
  });

  it('immediate:true forces delay 0', async () => {
    const { world, action } = await decidedAction();
    const r = await enqueueRecoveryAction(action.id, enqueueDepsFor(world), { immediate: true });
    if (r.status !== 'ENQUEUED') throw new Error('expected ENQUEUED');
    expect(r.delayMs).toBe(0);
  });

  it('re-enqueue of an already SCHEDULED action is a DUPLICATE no-op', async () => {
    const { world, action } = await decidedAction();
    await enqueueRecoveryAction(action.id, enqueueDepsFor(world), { immediate: true });
    const again = await enqueueRecoveryAction(action.id, enqueueDepsFor(world), {
      immediate: true,
    });
    expect(again.status).toBe('DUPLICATE');
    expect(world.audits.filter((a) => a.eventType === 'RECOVERY_ENQUEUED')).toHaveLength(1);
  });

  it('refuses a terminal HARD_STOP action', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world, {
      failure: { reason: 'mandate_revoked', source: 'BUSINESS' },
      classification: { cause: 'MANDATE_INVALID', confidence: 0.99 },
      payment: { method: 'MANDATE' },
    });
    const d = await decideRecovery(failureId, decideDepsFor(world));
    if (d.status !== 'DECIDED') throw new Error('setup');
    const r = await enqueueRecoveryAction(d.action.id, enqueueDepsFor(world));
    expect(r.status).toBe('NOT_ENQUEUEABLE');
    if (r.status !== 'NOT_ENQUEUEABLE') return;
    expect(r.reason).toMatch(/terminal/i);
  });

  it('refuses an action whose status is BLOCKED', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world, {
      classification: { cause: 'UNKNOWN', confidence: 0.2 },
    });
    const d = await decideRecovery(failureId, decideDepsFor(world));
    if (d.status !== 'DECIDED') throw new Error('setup');
    // UNKNOWN -> HUMAN_REVIEW is not schedulable at all
    const r = await enqueueRecoveryAction(d.action.id, enqueueDepsFor(world));
    expect(r.status).toBe('NOT_ENQUEUEABLE');
  });
});
