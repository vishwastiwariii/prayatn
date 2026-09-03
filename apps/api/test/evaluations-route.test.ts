import { runEvaluation } from '@recovery-desk/experiment';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createInMemoryEvaluationStore } from '../src/evaluations/service';
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

/** Real (deterministic) evaluation runner, small count so tests stay fast. */
async function start() {
  const store = createInMemoryEvaluationStore();
  app = await buildApp(testEnv, { evaluationDeps: { store, run: runEvaluation } });
  await app.ready();
  return { app, store };
}

describe('POST /api/evaluations', () => {
  it('runs an evaluation and returns { evaluationId, status: "COMPLETED" }', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/api/evaluations',
      payload: { seed: 20260904, count: 80 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({
      evaluationId: expect.stringMatching(/^eval_[0-9a-f]{8}$/),
      status: 'COMPLETED',
    });
  });

  it('is idempotent: identical params -> same id, 200 the second time', async () => {
    await start();
    const p = {
      payload: { seeds: [1, 2], count: 60 },
      method: 'POST' as const,
      url: '/api/evaluations',
    };
    const first = await app.inject(p);
    const second = await app.inject(p);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().evaluationId).toBe(first.json().evaluationId);
  });

  it('rejects an invalid body', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/api/evaluations',
      payload: { count: -5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().status).toBe('INVALID');
  });
});

describe('GET /api/evaluations/:evaluationId', () => {
  it('returns the full comparison summary', async () => {
    await start();
    const created = await app.inject({
      method: 'POST',
      url: '/api/evaluations',
      payload: { seeds: [7, 8], count: 80 },
    });
    const { evaluationId } = created.json();

    const res = await app.inject({ method: 'GET', url: `/api/evaluations/${evaluationId}` });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.evaluationId).toBe(evaluationId);
    expect(s.status).toBe('COMPLETED');
    expect(s.datasetSize).toBe(80);
    expect(s.seeds).toEqual([7, 8]);
    expect(s.headline.recoveryDesk.recoveredCount).toBeGreaterThan(s.headline.naive.recoveredCount);
    expect(Array.isArray(s.rootCauseBreakdown)).toBe(true);
    expect(
      s.rootCauseBreakdown.reduce(
        (a: number, r: { initialFailures: number }) => a + r.initialFailures,
        0,
      ),
    ).toBe(80);
    expect(s.perSeed).toHaveLength(2);
    expect(s.aggregate.recoveryDeskWinsEverySeed).toBe(true);
    expect(typeof s.renderedSummary).toBe('string');
    expect(s.renderedSummary).toContain('RECOVERY DESK — EXPERIMENT RESULTS');
  });

  it('404s for an unknown id', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/api/evaluations/eval_deadbeef' });
    expect(res.statusCode).toBe(404);
    expect(res.json().status).toBe('NOT_FOUND');
  });
});
