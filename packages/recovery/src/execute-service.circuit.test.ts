import { createCircuitBreaker, createInMemoryCircuitStore } from '@recovery-desk/circuit-breaker';
import { createSimulator } from '@recovery-desk/simulator';
import { describe, expect, it, vi } from 'vitest';
import { decideDepsFor, executeDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';
import { executeRecoveryAction } from './execute-service';

const ORIGIN = Date.UTC(2026, 8, 4, 10, 0, 0);

/** A clock the store, breaker and worker all share. */
function clock(startMs = ORIGIN) {
  let t = startMs;
  return {
    nowMs: () => t,
    nowDate: () => new Date(t),
    advance: (seconds: number) => {
      t += seconds * 1000;
    },
  };
}

/** decide -> mark SCHEDULED -> ready-to-execute RETRY action. */
async function scheduledRetry(world = makeWorld()) {
  const { failureId } = seedFailure(world, {
    payment: { amountMinor: 320_000, attemptCount: 1 },
    classification: { cause: 'GATEWAY_FAILURE', confidence: 0.9 },
  });
  const d = await decideRecovery(failureId, decideDepsFor(world));
  if (d.status !== 'DECIDED') throw new Error('setup');
  world.actions.get(d.action.id)!.status = 'SCHEDULED';
  return { world, actionId: d.action.id, paymentId: d.action.paymentId };
}

function breakerFor(c: ReturnType<typeof clock>, config = {}) {
  const store = createInMemoryCircuitStore({
    failureWindowSeconds: 60,
    probeLockTtlSeconds: 20,
    now: c.nowMs,
  });
  const cb = createCircuitBreaker({ store, now: c.nowMs, config, instanceId: 'w' });
  return { store, cb };
}

// Storm active from minute 5 onwards (so the demo timeline is simple).
const stormGateway = () =>
  createSimulator({
    seed: 1,
    recoversOnAttempt: 1,
    gatewayStorm: {
      enabled: true,
      originMs: ORIGIN,
      startMinute: 5,
      durationMinutes: 20,
      failureRate: 1,
      code: '503',
    },
  });

describe('circuit CLOSED — gateway 5xx does not consume a payment attempt', () => {
  it('records no outcome, does not increment attemptCount, reschedules, tells the breaker', async () => {
    const c = clock(ORIGIN + 6 * 60_000); // inside the storm
    const { cb } = breakerFor(c);
    const { world, actionId, paymentId } = await scheduledRetry();
    const gw = stormGateway();
    const onGwFail = vi.spyOn(cb, 'onGatewayFailure');

    const res = await executeRecoveryAction(
      actionId,
      executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb }),
    );

    expect(res.status).toBe('CIRCUIT_BLOCKED');
    if (res.status === 'CIRCUIT_BLOCKED') expect(res.trigger).toBe('GATEWAY_5XX');
    expect(onGwFail).toHaveBeenCalledTimes(1);
    expect(world.outcomes.size).toBe(0); // action stays re-executable
    expect(world.payments.get(paymentId)?.attemptCount).toBe(1); // unchanged
    expect(world.actions.get(actionId)?.status).toBe('SCHEDULED');
    expect(world.audits.some((a) => a.eventType === 'RECOVERY_BLOCKED_BY_CIRCUIT')).toBe(true);
  });
});

describe('circuit opens after the failure threshold, then blocks BEFORE calling the gateway', () => {
  it('5 gateway failures -> OPEN; further jobs are blocked with no gateway call', async () => {
    const c = clock(ORIGIN + 6 * 60_000);
    const { cb, store } = breakerFor(c);
    const gw = stormGateway();
    const chargeSpy = vi.spyOn(gw, 'charge');

    // 5 distinct actions all hit the storming gateway
    for (let i = 0; i < 5; i += 1) {
      const { world, actionId } = await scheduledRetry();
      const res = await executeRecoveryAction(
        actionId,
        executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb }),
      );
      expect(res.status).toBe('CIRCUIT_BLOCKED');
    }
    expect(chargeSpy).toHaveBeenCalledTimes(5);
    expect((await store.getState()).state).toBe('OPEN');

    // the 6th job: circuit is OPEN -> no gateway call at all
    const { world, actionId } = await scheduledRetry();
    const res = await executeRecoveryAction(
      actionId,
      executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb }),
    );
    expect(res.status).toBe('CIRCUIT_BLOCKED');
    if (res.status === 'CIRCUIT_BLOCKED') {
      expect(res.trigger).toBe('CIRCUIT_OPEN');
      expect(res.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(chargeSpy).toHaveBeenCalledTimes(5); // NOT 6 — no retry storm
  });
});

describe('cooldown -> HALF_OPEN probe -> gateway healthy -> CLOSED, recovery resumes', () => {
  it('one probe runs after cooldown; on success the circuit closes and the charge completes', async () => {
    const c = clock(ORIGIN + 6 * 60_000);
    const { cb, store } = breakerFor(c, { failureThreshold: 3 });
    const gw = stormGateway();

    for (let i = 0; i < 3; i += 1) {
      const { world, actionId } = await scheduledRetry();
      await executeRecoveryAction(
        actionId,
        executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb }),
      );
    }
    expect((await store.getState()).state).toBe('OPEN');

    // jump past cooldown AND past the storm window (storm ends at minute 25)
    c.advance(30 * 60);
    const { world, actionId, paymentId } = await scheduledRetry();
    const res = await executeRecoveryAction(
      actionId,
      executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb }),
    );

    expect(res.status).toBe('EXECUTED_SUCCESS');
    expect((await cb.getSnapshot()).state).toBe('CLOSED');
    expect(world.payments.get(paymentId)?.status).toBe('SUCCEEDED');
    expect(world.outcomes.size).toBe(1);
  });
});

describe('idempotency — a duplicate job delivery cannot double-charge', () => {
  it('the second execution detects the existing outcome and does nothing', async () => {
    const c = clock(ORIGIN); // before the storm -> healthy gateway
    const { cb } = breakerFor(c);
    const { world, actionId, paymentId } = await scheduledRetry();
    const gw = createSimulator({ recoversOnAttempt: 1 });
    const chargeSpy = vi.spyOn(gw, 'charge');
    const deps = executeDepsFor(world, gw, c.nowDate, { circuitBreaker: cb });

    const first = await executeRecoveryAction(actionId, deps);
    const second = await executeRecoveryAction(actionId, deps); // same paymentId + attemptNumber

    expect(first.status).toBe('EXECUTED_SUCCESS');
    expect(second.status).toBe('DUPLICATE');
    expect(chargeSpy).toHaveBeenCalledTimes(1); // ONE actual charge
    expect(world.outcomes.size).toBe(1);
    expect(world.payments.get(paymentId)?.attemptCount).toBe(2);
  });
});

describe('no circuit breaker configured -> Phase 9 behaviour is unchanged', () => {
  it('executes normally without any circuit involvement', async () => {
    const c = clock(ORIGIN);
    const { world, actionId } = await scheduledRetry();
    const gw = createSimulator({ recoversOnAttempt: 1 });
    const res = await executeRecoveryAction(actionId, executeDepsFor(world, gw, c.nowDate));
    expect(res.status).toBe('EXECUTED_SUCCESS');
  });
});
