import { describe, expect, it, vi } from 'vitest';
import type { Gateway } from '@recovery-desk/simulator';
import { createSimulator } from '@recovery-desk/simulator';
import { decideDepsFor, executeDepsFor, makeWorld, seedFailure } from './_fakes';
import { decideRecovery } from './decide-service';
import { executeRecoveryAction } from './execute-service';

/**
 * Phase 14 §2/§3 — the financial-safety guarantee, stated as tests.
 *
 *   BullMQ retry  ≠  payment retry
 *
 * A worker can crash, a job can be redelivered, an operator can double-click,
 * and a queue can be drained twice. None of those may become a second charge.
 * These tests count actual gateway calls, not just returned statuses.
 */

/** Wraps a real simulator and counts every charge that reaches it. */
function countingGateway(): { gateway: Gateway; charges: () => number } {
  const inner = createSimulator({ recoversOnAttempt: 1 });
  const charge = vi.fn(inner.charge);
  return {
    gateway: { ...inner, charge } as Gateway,
    charges: () => charge.mock.calls.length,
  };
}

async function seedApprovedAction() {
  const world = makeWorld();
  const { failureId } = seedFailure(world);
  const decided = await decideRecovery(failureId, decideDepsFor(world));
  if (decided.status !== 'DECIDED') throw new Error(`expected DECIDED, got ${decided.status}`);
  return { world, actionId: decided.action.id };
}

describe('payment execution is idempotent', () => {
  it('a redelivered job charges the gateway exactly once', async () => {
    const { world, actionId } = await seedApprovedAction();
    const { gateway, charges } = countingGateway();
    const deps = executeDepsFor(world, gateway);

    const first = await executeRecoveryAction(actionId, deps);
    // Simulates BullMQ redelivering the same job after a worker crash.
    const second = await executeRecoveryAction(actionId, deps);
    const third = await executeRecoveryAction(actionId, deps);

    expect(first.status).toBe('EXECUTED_SUCCESS');
    expect(second.status).toBe('DUPLICATE');
    expect(third.status).toBe('DUPLICATE');
    expect(charges()).toBe(1);
    expect(world.outcomes.size).toBe(1);
  });

  it('the payment attempt count is incremented once, not once per delivery', async () => {
    const { world, actionId } = await seedApprovedAction();
    const { gateway } = countingGateway();
    const deps = executeDepsFor(world, gateway);

    const before = [...world.payments.values()][0]?.attemptCount ?? 0;
    await executeRecoveryAction(actionId, deps);
    await executeRecoveryAction(actionId, deps);
    const after = [...world.payments.values()][0]?.attemptCount ?? 0;

    expect(after - before).toBe(1);
  });

  it('concurrent deliveries of the same job still produce one outcome', async () => {
    const { world, actionId } = await seedApprovedAction();
    const { gateway, charges } = countingGateway();
    const deps = executeDepsFor(world, gateway);

    // The in-memory fake serialises writes the way the DB unique constraint
    // does; what this asserts is that the executor never *assumes* it is alone.
    await Promise.all([
      executeRecoveryAction(actionId, deps),
      executeRecoveryAction(actionId, deps),
      executeRecoveryAction(actionId, deps),
    ]);

    expect(world.outcomes.size).toBe(1);
    expect(charges()).toBeLessThanOrEqual(1);
  });
});

describe('decision authoring is idempotent', () => {
  it('deciding the same failure twice creates one recovery action', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world);
    const deps = decideDepsFor(world);

    const first = await decideRecovery(failureId, deps);
    const second = await decideRecovery(failureId, deps);

    expect(first.status).toBe('DECIDED');
    expect(second.status).toBe('DUPLICATE');
    expect(world.actions.size).toBe(1);
  });

  it('the idempotency key is derived from the classification, not the clock', async () => {
    const world = makeWorld();
    const { failureId } = seedFailure(world);

    let t = Date.UTC(2026, 8, 10, 12, 0, 0);
    const deps = decideDepsFor(world, () => new Date(t));
    await decideRecovery(failureId, deps);
    t += 60 * 60 * 1000; // an hour later — a retried API call, not a new decision
    const later = await decideRecovery(failureId, deps);

    expect(later.status).toBe('DUPLICATE');
    expect(world.actions.size).toBe(1);
  });
});

describe('an outcome is never fabricated', () => {
  it('a duplicate delivery does not write a second audit trail entry for a charge', async () => {
    const { world, actionId } = await seedApprovedAction();
    const { gateway } = countingGateway();
    const deps = executeDepsFor(world, gateway);

    await executeRecoveryAction(actionId, deps);
    const auditsAfterFirst = world.audits.length;
    await executeRecoveryAction(actionId, deps);

    expect(world.audits.length).toBe(auditsAfterFirst);
  });
});
