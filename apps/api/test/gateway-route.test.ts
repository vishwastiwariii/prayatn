import { createCircuitBreaker, createInMemoryCircuitStore } from '@recovery-desk/circuit-breaker';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

function build() {
  let t = Date.UTC(2026, 8, 4, 10, 0, 0);
  const now = () => t;
  const store = createInMemoryCircuitStore({
    failureWindowSeconds: 60,
    probeLockTtlSeconds: 20,
    now,
  });
  const cb = createCircuitBreaker({ store, now, instanceId: 'api' });
  return { cb, advance: (s: number) => (t += s * 1000) };
}

describe('GET /api/gateway/circuit', () => {
  it('reports a healthy CLOSED circuit', async () => {
    const { cb } = build();
    app = await buildApp(testEnv, { gatewayDeps: { circuitBreaker: cb } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/gateway/circuit' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'CLOSED',
      failureCount: 0,
      failureThreshold: 5,
      openedAt: null,
      cooldownSeconds: 30,
      remainingCooldownSeconds: 0,
      halfOpenProbeInProgress: false,
    });
  });

  it('reflects an OPEN circuit with a live cooldown countdown and metrics', async () => {
    const { cb, advance } = build();
    for (let i = 0; i < 7; i += 1) await cb.onGatewayFailure();
    advance(12);
    app = await buildApp(testEnv, { gatewayDeps: { circuitBreaker: cb } });
    await app.ready();

    const body = (await app.inject({ method: 'GET', url: '/api/gateway/circuit' })).json();
    expect(body.state).toBe('OPEN');
    expect(body.failureCount).toBe(7);
    expect(body.remainingCooldownSeconds).toBe(18);
    expect(typeof body.openedAt).toBe('string');
    expect(body.config.circuit.failureThreshold).toBe(5);
    expect(body.config.drain.batchSize).toBe(5);
    expect(body.metrics.gatewayFailures).toBe(7);
    expect(body.metrics.circuitOpenCount).toBe(1);
  });

  it('is read-only: there is no route to force the state', async () => {
    const { cb } = build();
    app = await buildApp(testEnv, { gatewayDeps: { circuitBreaker: cb } });
    await app.ready();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/gateway/circuit' });
      expect(res.statusCode).toBe(404);
    }
  });
});
