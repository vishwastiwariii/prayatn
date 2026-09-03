import { createSimulator } from '@recovery-desk/simulator';
import { describe, expect, it, vi } from 'vitest';
import { decideDepsFor, executeDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';
import { executeRecoveryAction } from './execute-service';
import { InfrastructureError } from './queue';

/** decide -> (pretend enqueue) -> return the SCHEDULED action id + world */
async function scheduledRetry(paymentOver = {}) {
  const world = makeWorld();
  const { failureId } = seedFailure(world, { payment: paymentOver });
  const d = await decideRecovery(failureId, decideDepsFor(world));
  if (d.status !== 'DECIDED') throw new Error('setup');
  world.actions.get(d.action.id)!.status = 'SCHEDULED';
  return { world, actionId: d.action.id, paymentId: d.action.paymentId };
}

describe('executeRecoveryAction — success path (mock gateway)', () => {
  it('charges the pre-approved retry, records SUCCESS, marks the payment SUCCEEDED', async () => {
    const { world, actionId, paymentId } = await scheduledRetry();
    const gw = createSimulator(); // default: attempt 2 succeeds

    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw));

    expect(res.status).toBe('EXECUTED_SUCCESS');
    if (res.status !== 'EXECUTED_SUCCESS') return;
    expect(res.paymentStatus).toBe('SUCCEEDED');
    expect(res.recoveryStatus).toBe('RECOVERED');

    const outcome = [...world.outcomes.values()][0];
    expect(outcome?.status).toBe('SUCCESS');
    expect(outcome?.amountRecoveredMinor).toBe(250000);

    const payment = world.payments.get(paymentId);
    expect(payment?.status).toBe('SUCCEEDED');
    expect(payment?.attemptCount).toBe(2);

    expect(world.actions.get(actionId)?.status).toBe('EXECUTED');
    expect(world.actions.get(actionId)?.executedAt).not.toBeNull();
    expect(world.audits.some((a) => a.eventType === 'RECOVERY_EXECUTED')).toBe(true);
  });
});

describe('executeRecoveryAction — decline is NOT an error', () => {
  it('records FAILED and moves the payment to RECOVERING (job still completes)', async () => {
    const { world, actionId, paymentId } = await scheduledRetry();
    const gw = createSimulator({ forceFailure: true });

    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw));

    expect(res.status).toBe('EXECUTED_FAILURE'); // returned, not thrown
    const outcome = [...world.outcomes.values()][0];
    expect(outcome?.status).toBe('FAILED');
    expect(outcome?.failureReason).toContain('issuer_declined');
    const payment = world.payments.get(paymentId);
    expect(payment?.status).toBe('RECOVERING');
    expect(payment?.recoveryStatus).toBe('RETRYING');
    expect(payment?.attemptCount).toBe(2);
  });

  it('a decline that hits the attempt ceiling moves the payment to EXHAUSTED', async () => {
    const { world, actionId, paymentId } = await scheduledRetry({ attemptCount: 2 }); // maxAttempts 3
    const gw = createSimulator({ forceFailure: true });
    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw));
    expect(res.status).toBe('EXECUTED_FAILURE');
    expect(world.payments.get(paymentId)?.status).toBe('EXHAUSTED');
  });
});

describe('executeRecoveryAction — safety re-check blocks (never re-decides policy)', () => {
  it('blocks when the payment already SUCCEEDED, without charging', async () => {
    const { world, actionId, paymentId } = await scheduledRetry();
    world.payments.get(paymentId)!.status = 'SUCCEEDED';
    const gw = createSimulator();
    const chargeSpy = vi.spyOn(gw, 'charge');

    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw));
    expect(res.status).toBe('BLOCKED');
    if (res.status === 'BLOCKED') expect(res.note).toBe('already_recovered');
    expect(chargeSpy).not.toHaveBeenCalled();
    expect([...world.outcomes.values()][0]?.status).toBe('CANCELLED');
  });

  it('blocks when the attempt ceiling was reached AFTER the action was approved', async () => {
    // Approved as RETRY at attemptCount 1; a concurrent attempt then consumed
    // the remaining budget before this job ran.
    const { world, actionId, paymentId } = await scheduledRetry();
    world.payments.get(paymentId)!.attemptCount = 3; // == maxAttempts
    const gw = createSimulator();
    const chargeSpy = vi.spyOn(gw, 'charge');
    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw));
    expect(res.status).toBe('BLOCKED');
    if (res.status === 'BLOCKED') expect(res.note).toBe('attempt_limit_reached');
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(world.payments.get(paymentId)?.status).toBe('EXHAUSTED');
  });

  it('blocks a CANCELLED action', async () => {
    const { world, actionId } = await scheduledRetry();
    world.actions.get(actionId)!.status = 'CANCELLED';
    const res = await executeRecoveryAction(actionId, executeDepsFor(world, createSimulator()));
    expect(res.status).toBe('BLOCKED');
    if (res.status === 'BLOCKED') expect(res.note).toBe('action_cancelled');
  });
});

describe('executeRecoveryAction — idempotency', () => {
  it('a second run is a no-op DUPLICATE', async () => {
    const { world, actionId } = await scheduledRetry();
    const gw = createSimulator();
    await executeRecoveryAction(actionId, executeDepsFor(world, gw));
    const chargeSpy = vi.spyOn(gw, 'charge');
    const again = await executeRecoveryAction(actionId, executeDepsFor(world, gw));
    expect(again.status).toBe('DUPLICATE');
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(world.outcomes.size).toBe(1);
  });

  it('unknown action id -> ACTION_NOT_FOUND', async () => {
    const res = await executeRecoveryAction('nope', executeDepsFor(makeWorld(), createSimulator()));
    expect(res.status).toBe('ACTION_NOT_FOUND');
  });
});

describe('executeRecoveryAction — MESSAGE action', () => {
  it('sends a message and leaves the payment untouched', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world, {
      failure: { reason: '3ds_abandoned', source: 'CUSTOMER', step: 'AUTHENTICATION' },
      classification: { cause: 'CUSTOMER_ABANDONMENT', confidence: 0.85 },
      payment: { method: 'CARD' },
    });
    const d = await decideRecovery(failureId, decideDepsFor(world));
    if (d.status !== 'DECIDED') throw new Error('setup');
    expect(d.decision.action).toBe('MESSAGE');
    world.actions.get(d.action.id)!.status = 'SCHEDULED';

    const gw = createSimulator();
    const res = await executeRecoveryAction(d.action.id, executeDepsFor(world, gw));
    expect(res.status).toBe('EXECUTED_SUCCESS');
    expect([...world.outcomes.values()][0]?.status).toBe('SUCCESS');
    expect(world.payments.get(d.action.paymentId)?.status).toBe('FAILED'); // unchanged
    expect(world.payments.get(d.action.paymentId)?.attemptCount).toBe(1); // no charge
  });
});

describe('executeRecoveryAction — infrastructure faults throw (BullMQ retries those)', () => {
  it('wraps a persistOutcome failure as InfrastructureError', async () => {
    const { world, actionId } = await scheduledRetry();
    const deps = executeDepsFor(world, createSimulator());
    deps.persistOutcome = async () => {
      throw new Error('connection reset by peer');
    };
    await expect(executeRecoveryAction(actionId, deps)).rejects.toBeInstanceOf(InfrastructureError);
  });

  it('wraps a gateway throw as InfrastructureError', async () => {
    const { world, actionId } = await scheduledRetry();
    const gw = createSimulator();
    vi.spyOn(gw, 'charge').mockImplementation(() => {
      throw new Error('socket hang up');
    });
    await expect(executeRecoveryAction(actionId, executeDepsFor(world, gw))).rejects.toBeInstanceOf(
      InfrastructureError,
    );
  });
});
