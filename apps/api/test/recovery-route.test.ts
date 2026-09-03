import {
  decideDepsFor,
  enqueueDepsFor,
  makeWorld,
  seedFailure,
} from '@recovery-desk/recovery/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Env } from '../src/env';

const testEnv: Env = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  API_PORT: 4000,
  API_HOST: '0.0.0.0',
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
};

let app: FastifyInstance;
afterEach(() => app?.close());

function bootWithWorld() {
  const world = makeWorld();
  return {
    world,
    async start() {
      app = await buildApp(testEnv, {
        recoveryDeps: { decide: decideDepsFor(world), enqueue: enqueueDepsFor(world) },
      });
      await app.ready();
      return app;
    },
  };
}

describe('POST /api/payments/failures/:failureId/decide', () => {
  it('201 DECIDED — persists the approved RETRY action', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world); // ISSUER_TEMPORARY_FAILURE
    await start();

    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/failures/${failureId}/decide`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('DECIDED');
    expect(body.decision.action).toBe('RETRY');
    expect(body.decision.delayMinutes).toBe(18);
    expect(body.action.status).toBe('PENDING');
    expect(body.action.attemptNumber).toBe(2);
  });

  it('200 DUPLICATE on a second call', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world);
    await start();
    await app.inject({ method: 'POST', url: `/api/payments/failures/${failureId}/decide` });
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/failures/${failureId}/decide`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DUPLICATE');
  });

  it('404 for an unknown failure', async () => {
    const { start } = bootWithWorld();
    await start();
    const res = await app.inject({ method: 'POST', url: '/api/payments/failures/nope/decide' });
    expect(res.statusCode).toBe(404);
  });

  it('409 NOT_CLASSIFIED when the failure has no classification', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world, { classification: null });
    await start();
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/failures/${failureId}/decide`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('NOT_CLASSIFIED');
  });
});

describe('POST /api/recovery-actions/:actionId/enqueue', () => {
  async function decide(failureId: string) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/payments/failures/${failureId}/decide`,
    });
    return r.json().action.actionId as string;
  }

  it('202 ENQUEUED for a fresh approved action', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world);
    await start();
    const actionId = await decide(failureId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/recovery-actions/${actionId}/enqueue`,
      payload: { immediate: true },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('ENQUEUED');
    expect(body.jobId).toBe(actionId);
    expect(body.delayMs).toBe(0);
    expect(body.action.status).toBe('SCHEDULED');
  });

  it('200 DUPLICATE when re-enqueuing', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world);
    await start();
    const actionId = await decide(failureId);
    await app.inject({
      method: 'POST',
      url: `/api/recovery-actions/${actionId}/enqueue`,
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/recovery-actions/${actionId}/enqueue`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DUPLICATE');
  });

  it('404 for an unknown action', async () => {
    const { start } = bootWithWorld();
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/api/recovery-actions/nope/enqueue',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('409 NOT_ENQUEUEABLE for a terminal HARD_STOP action', async () => {
    const { world, start } = bootWithWorld();
    const { failureId } = seedFailure(world, {
      failure: { reason: 'mandate_revoked', source: 'BUSINESS' },
      classification: { cause: 'MANDATE_INVALID', confidence: 0.99 },
      payment: { method: 'MANDATE' },
    });
    await start();
    const actionId = await decide(failureId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/recovery-actions/${actionId}/enqueue`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('NOT_ENQUEUEABLE');
  });
});
