import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Env } from '../src/env';

/**
 * Edge-only tests for POST /api/payments/failures: the header and body
 * validation branches all short-circuit before the pipeline touches Postgres,
 * so they run without a database. The persist / duplicate / audit path is
 * covered by the manual Phase 4 verification (needs docker compose up).
 */
const testEnv: Env = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  API_PORT: 4000,
  API_HOST: '0.0.0.0',
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
};

const validFlatBody = {
  paymentId: 'pay_123',
  amount: 2500,
  method: 'card',
  error: {
    code: 'BAD_REQUEST_ERROR',
    reason: 'insufficient_funds',
    source: 'bank',
    step: 'authorization',
    description: 'Insufficient funds',
  },
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(testEnv);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/payments/failures — validation edge', () => {
  it('rejects a request with no Idempotency-Key header (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures',
      payload: validFlatBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().status).toBe('INVALID');
    expect(res.json().error).toMatch(/Idempotency-Key/);
  });

  it('rejects a blank Idempotency-Key header (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures',
      headers: { 'idempotency-key': '   ' },
      payload: validFlatBody,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a structurally invalid body and lists the offending paths (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures',
      headers: { 'idempotency-key': 'key-1' },
      payload: { paymentId: 'pay_1', amount: -3, method: 'card' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.status).toBe('INVALID');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported payment method as UNPROCESSABLE (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures',
      headers: { 'idempotency-key': 'key-2' },
      payload: { ...validFlatBody, method: 'crypto' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe('UNPROCESSABLE');
  });
});
