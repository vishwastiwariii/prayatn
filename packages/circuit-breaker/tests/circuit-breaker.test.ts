import { describe, expect, it, vi } from 'vitest';
import { createCircuitBreaker } from '../src/circuit-breaker';
import { createInMemoryCircuitStore } from '../src/memory-store';
import { toGatewayResult } from '../src/gateway-result';

/** A controllable clock shared by the store and the breaker. */
function harness(over: Parameters<typeof createCircuitBreaker>[0]['config'] = {}) {
  let t = 1_000_000;
  const now = () => t;
  const advance = (seconds: number) => {
    t += seconds * 1000;
  };
  const store = createInMemoryCircuitStore({
    failureWindowSeconds: 60,
    probeLockTtlSeconds: 20,
    now,
  });
  const hooks = {
    onOpen: vi.fn(),
    onHalfOpen: vi.fn(),
    onClose: vi.fn(),
    onProbeSucceeded: vi.fn(),
    onProbeFailed: vi.fn(),
  };
  const cb = createCircuitBreaker({ store, now, hooks, config: over, instanceId: 'A' });
  return {
    cb,
    store,
    hooks,
    now,
    advance,
    makeSecond: () => createCircuitBreaker({ store, now, instanceId: 'B' }),
  };
}

describe('CircuitBreaker — full lifecycle over the shared store', () => {
  it('CLOSED: allows requests; below threshold stays closed', async () => {
    const { cb } = harness();
    for (let i = 0; i < 4; i += 1) await cb.onGatewayFailure();
    const perm = await cb.beforeRequest();
    expect(perm).toEqual({ allowed: true, isProbe: false });
    expect((await cb.getSnapshot()).state).toBe('CLOSED');
  });

  it('CLOSED -> OPEN at the 5th failure, audited once, then blocks + reschedules', async () => {
    const { cb, hooks } = harness();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();

    const snap = await cb.getSnapshot();
    expect(snap.state).toBe('OPEN');
    expect(snap.failureCount).toBe(5);
    expect(hooks.onOpen).toHaveBeenCalledTimes(1);
    expect(hooks.onOpen.mock.calls[0]?.[0].reason).toMatch(/5 failures in 60 seconds/);

    const perm = await cb.beforeRequest();
    expect(perm).toMatchObject({ allowed: false, reason: 'CIRCUIT_OPEN' });
    if (!perm.allowed) expect(perm.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('OPEN -> HALF_OPEN after cooldown; probe success -> CLOSED (audited)', async () => {
    const { cb, hooks, advance } = harness();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();
    expect((await cb.beforeRequest()).allowed).toBe(false);

    advance(30); // cooldown elapses
    const probe = await cb.beforeRequest();
    expect(probe).toEqual({ allowed: true, isProbe: true });
    expect(hooks.onHalfOpen).toHaveBeenCalledTimes(1);

    await cb.onSuccess();
    expect((await cb.getSnapshot()).state).toBe('CLOSED');
    expect(hooks.onProbeSucceeded).toHaveBeenCalledTimes(1);
    expect(hooks.onClose).toHaveBeenCalledTimes(1);
    // failure window was reset
    expect((await cb.getSnapshot()).failureCount).toBe(0);
  });

  it('HALF_OPEN probe fails -> OPEN again, cooldown restarts (audited)', async () => {
    const { cb, hooks, advance } = harness();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();
    advance(30);
    await cb.beforeRequest(); // acquire probe

    await cb.onGatewayFailure(); // probe fails
    const snap = await cb.getSnapshot();
    expect(snap.state).toBe('OPEN');
    expect(snap.remainingCooldownSeconds).toBe(30); // restarted
    expect(hooks.onProbeFailed).toHaveBeenCalledTimes(1);
    expect(hooks.onOpen.mock.calls.at(-1)?.[0].reopened).toBe(true);
  });

  it('only ONE worker gets the half-open probe (concurrent)', async () => {
    const { cb, advance, makeSecond } = harness();
    const cbB = makeSecond();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();
    advance(30);

    const [a, b] = await Promise.all([cb.beforeRequest(), cbB.beforeRequest()]);
    const allowed = [a, b].filter((p) => p.allowed);
    const blocked = [a, b].filter((p) => !p.allowed);
    expect(allowed).toHaveLength(1);
    expect(allowed[0]).toMatchObject({ allowed: true, isProbe: true });
    expect(blocked[0]).toMatchObject({ allowed: false, reason: 'PROBE_ALREADY_IN_PROGRESS' });
  });

  it('two workers crossing the threshold simultaneously open the circuit once', async () => {
    const { cb, hooks, makeSecond } = harness();
    const cbB = makeSecond();
    for (let i = 0; i < 4; i += 1) await cb.onGatewayFailure();
    // both observe the 5th/6th failure "at once"
    await Promise.all([cb.onGatewayFailure(), cbB.onGatewayFailure()]);
    expect((await cb.getSnapshot()).state).toBe('OPEN');
    expect(hooks.onOpen).toHaveBeenCalledTimes(1); // exactly one CIRCUIT_OPENED
  });

  it('a PAYMENT_FAILURE result does not trip the circuit', async () => {
    const { cb } = harness();
    for (let i = 0; i < 8; i += 1) {
      const r = toGatewayResult({ status: 'FAILURE', code: 'insufficient_funds', reason: 'NSF' });
      expect(r.status).toBe('PAYMENT_FAILURE');
      await cb.onSuccess(); // gateway itself was fine
    }
    expect((await cb.getSnapshot()).state).toBe('CLOSED');
  });

  it('staggers reschedule delays into drain batches while OPEN', async () => {
    const { cb } = harness({ failureThreshold: 3 });
    for (let i = 0; i < 3; i += 1) await cb.onGatewayFailure();
    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const p = await cb.beforeRequest();
      if (!p.allowed) delays.push(p.retryAfterSeconds);
    }
    // batchSize 5, interval 5s -> first 5 share a delay, next 5 are +5s, ...
    const base = delays[0] ?? 0;
    expect(delays).toHaveLength(12);
    expect(delays[4]).toBe(base);
    expect(delays[5]).toBe(base + 5);
    expect(delays[10]).toBe(base + 10);
  });

  it('getSnapshot exposes the observability shape', async () => {
    const { cb, advance } = harness();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();
    advance(12);
    const s = await cb.getSnapshot();
    expect(s).toMatchObject({
      state: 'OPEN',
      failureCount: 5,
      failureThreshold: 5,
      cooldownSeconds: 30,
      remainingCooldownSeconds: 18,
      halfOpenProbeInProgress: false,
    });
    expect(typeof s.openedAt).toBe('string');
  });

  it('tracks gateway reliability metrics', async () => {
    const { cb, advance } = harness();
    for (let i = 0; i < 5; i += 1) await cb.onGatewayFailure();
    await cb.beforeRequest(); // blocked
    advance(30);
    await cb.beforeRequest(); // probe
    await cb.onSuccess(); // close
    const m = await cb.getMetrics();
    expect(m.gatewayFailures).toBe(5);
    expect(m.circuitOpenCount).toBe(1);
    expect(m.blockedRecoveryAttempts).toBe(1);
    expect(m.probeAttempts).toBe(1);
    expect(m.successfulProbes).toBe(1);
    expect(m.resumedAfterRecovery).toBe(1);
  });
});
