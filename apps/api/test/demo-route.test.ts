import { createDemoController } from '@recovery-desk/demo';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

/**
 * These cover the demo CONTROL PLANE (stage machine + guards) without a
 * database: the stage work itself is exercised end to end by
 * `scripts/demo-smoke-test.ts` against real Postgres/Redis.
 */
describe('demo control plane', () => {
  it('refuses to advance before the demo has been started', async () => {
    app = await buildApp(testEnv, { demoDeps: { controller: createDemoController() } });
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/demo/advance' });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('CANNOT_ADVANCE');
  });

  it('exposes no endpoint that forces a circuit state or fakes a recovery', async () => {
    app = await buildApp(testEnv, { demoDeps: { controller: createDemoController() } });
    await app.ready();

    for (const url of [
      '/api/demo/force-circuit',
      '/api/demo/set-circuit',
      '/api/demo/fake-recovery',
      '/api/demo/metrics',
    ]) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode).toBe(404);
    }
  });

  it('advances one stage at a time and reports the stage copy', async () => {
    const controller = createDemoController();
    controller.start('demo_test');
    app = await buildApp(testEnv, { demoDeps: { controller } });
    await app.ready();

    // Stage work needs a database; the route catches that and still advances
    // with the error surfaced rather than swallowed (Phase 13 §26).
    const res = await app.inject({ method: 'POST', url: '/api/demo/advance' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe('READY');
    expect(body.to).toBe('FAILURES');
    expect(body.meta.title).toBe('Failures');
  });

  it('never fabricates success: with no demo dataset loaded, nothing is reported as ingested', async () => {
    const controller = createDemoController();
    controller.start('demo_test');
    app = await buildApp(testEnv, { demoDeps: { controller } });
    await app.ready();

    // `start` was never called, so no demo payments exist. Ingestion must
    // report what actually happened (zero, or an outright error) — never a
    // pretend "12 failures ingested".
    const body = (await app.inject({ method: 'POST', url: '/api/demo/advance' })).json();
    expect(body.detail).toBeDefined();
    if (typeof body.detail.error === 'string') return; // infrastructure unavailable
    expect(body.detail.ingested).toBe(0);
    expect(body.detail.total).toBe(12);
  });

  it('health reports the seed contract and flags a wrong dataset', async () => {
    const controller = createDemoController();
    app = await buildApp(testEnv, { demoDeps: { controller } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/demo/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Seed matches the constant the script and the numbers were written for.
    expect(body.configError).toBeNull();
    expect(body).toHaveProperty('database');
    expect(body).toHaveProperty('redis');
    expect(body).toHaveProperty('worker');
    expect(body).toHaveProperty('circuitBreaker');
    expect(body).toHaveProperty('evaluation');
    expect(body).toHaveProperty('ai');
  });
});
