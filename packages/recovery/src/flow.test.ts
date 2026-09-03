import { createSimulator } from '@recovery-desk/simulator';
import { describe, expect, it } from 'vitest';
import { decideDepsFor, enqueueDepsFor, executeDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';
import { enqueueRecoveryAction } from './enqueue-service';
import { executeRecoveryAction } from './execute-service';

/**
 * The complete asynchronous recovery flow, end to end, with the mock gateway:
 *
 *   PaymentFailure + Classification (ISSUER_TEMPORARY_FAILURE)
 *     -> POST /decide   -> RecoveryAction { RETRY, +18min }        (approved)
 *     -> POST /enqueue  -> job on the queue                        (jobId = actionId)
 *     -> Recovery Worker -> Mock Gateway -> SUCCESS
 *     -> RecoveryOutcome { SUCCESS }
 *     -> Payment = SUCCEEDED
 *     -> Audit trail: POLICY_DECISION -> RECOVERY_ENQUEUED -> RECOVERY_EXECUTED
 *
 * The queue itself is exercised for real in pipeline.integration.test.ts; here
 * the job hand-off is stubbed so the test is fast and deterministic, but every
 * service (`decideRecovery`, `enqueueRecoveryAction`, `executeRecoveryAction`)
 * and the policy engine + gateway run for real.
 */
describe('complete recovery flow (mock gateway)', () => {
  it('classified issuer failure -> RETRY -> queue -> worker -> SUCCEEDED', async () => {
    const world = makeWorld();
    // "POST /payments/failures" + "POST /classify" already happened:
    const { failureId, paymentId } = seedFailure(world, {
      payment: { amountMinor: 320000, attemptCount: 1 },
      classification: { cause: 'ISSUER_TEMPORARY_FAILURE', confidence: 0.94 },
    });

    // 1) POST /decide  -> approve exactly one RecoveryAction
    const decided = await decideRecovery(failureId, decideDepsFor(world));
    expect(decided.status).toBe('DECIDED');
    if (decided.status !== 'DECIDED') return;
    expect(decided.decision.action).toBe('RETRY');
    expect(decided.decision.delayMinutes).toBe(18);
    const actionId = decided.action.id;
    expect(world.actions.get(actionId)?.status).toBe('PENDING');

    // 2) POST /enqueue -> put the approved action on the queue
    let enqueuedJob: { data: unknown; delayMs: number } | null = null;
    const enqueued = await enqueueRecoveryAction(
      actionId,
      enqueueDepsFor(world, { onEnqueue: (data, delayMs) => (enqueuedJob = { data, delayMs }) }),
      { immediate: true },
    );
    expect(enqueued.status).toBe('ENQUEUED');
    if (enqueued.status !== 'ENQUEUED') return;
    expect(enqueued.jobId).toBe(actionId);
    expect(enqueuedJob).not.toBeNull();
    expect(world.actions.get(actionId)?.status).toBe('SCHEDULED');

    // 3) Recovery worker consumes the job -> mock gateway -> SUCCESS
    const gateway = createSimulator(); // default: the first retry (attempt 2) succeeds
    const executed = await executeRecoveryAction(actionId, executeDepsFor(world, gateway));
    expect(executed.status).toBe('EXECUTED_SUCCESS');

    // 4) RecoveryOutcome persisted
    const outcome = [...world.outcomes.values()][0];
    expect(outcome?.status).toBe('SUCCESS');
    expect(outcome?.amountRecoveredMinor).toBe(320000);
    expect(outcome?.gatewayLatencyMs).toBeGreaterThan(0);

    // 5) Payment = SUCCEEDED
    const payment = world.payments.get(paymentId);
    expect(payment?.status).toBe('SUCCEEDED');
    expect(payment?.recoveryStatus).toBe('RECOVERED');
    expect(payment?.attemptCount).toBe(2);
    expect(world.actions.get(actionId)?.status).toBe('EXECUTED');

    // 6) Audit trail, in order
    expect(world.audits.map((a) => a.eventType)).toEqual([
      'POLICY_DECISION',
      'RECOVERY_ENQUEUED',
      'RECOVERY_EXECUTED',
    ]);
  });

  it('flaky issuer that never recovers -> retries exhaust -> EXHAUSTED, no invented policy', async () => {
    const world = makeWorld();
    const { failureId, paymentId } = seedFailure(world, {
      payment: { attemptCount: 2 }, // one retry left before the ceiling of 3
      classification: { cause: 'ISSUER_TEMPORARY_FAILURE', confidence: 0.94 },
    });
    const decided = await decideRecovery(failureId, decideDepsFor(world));
    if (decided.status !== 'DECIDED') throw new Error('setup');
    await enqueueRecoveryAction(decided.action.id, enqueueDepsFor(world), { immediate: true });

    const res = await executeRecoveryAction(
      decided.action.id,
      executeDepsFor(world, createSimulator({ forceFailure: true })),
    );

    expect(res.status).toBe('EXECUTED_FAILURE');
    expect(world.payments.get(paymentId)?.status).toBe('EXHAUSTED');
    // the worker recorded an outcome; it did NOT schedule another attempt itself
    expect(world.outcomes.size).toBe(1);
    expect(world.actions.size).toBe(1);
  });
});
