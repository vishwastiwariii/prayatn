import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import { requiredRoles, isPublic } from '../src/plugins/auth';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

const ADMIN = 'admin-key-0123456789abcdef';
const OPERATOR = 'operator-key-0123456789abcdef';
const DEMO = 'demo-key-0123456789abcdef';

const securedEnv = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  LOG_LEVEL: 'silent',
  AUTH_ENABLED: 'true',
  ADMIN_API_KEY: ADMIN,
  OPERATOR_API_KEY: OPERATOR,
  DEMO_API_KEY: DEMO,
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('configuration (Phase 14 §7)', () => {
  it('fails fast in production when admin/operator secrets are missing', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/db',
        REDIS_URL: 'redis://redis:6379',
        CORS_ORIGIN: 'https://recovery.example.com',
      }),
    ).toThrow(/Refusing to start in production/);
  });

  it('fails fast in production when auth is disabled', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/db',
        REDIS_URL: 'redis://redis:6379',
        CORS_ORIGIN: 'https://recovery.example.com',
        ADMIN_API_KEY: ADMIN,
        OPERATOR_API_KEY: OPERATOR,
        AUTH_ENABLED: 'false',
      }),
    ).toThrow(/AUTH_ENABLED must be true/);
  });

  it('fails fast in production when CORS still points at localhost', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/db',
        REDIS_URL: 'redis://redis:6379',
        ADMIN_API_KEY: ADMIN,
        OPERATOR_API_KEY: OPERATOR,
        AUTH_ENABLED: 'true',
        CORS_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(/CORS_ORIGIN still points at localhost/);
  });

  it('starts in production when everything required is present', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/db',
      REDIS_URL: 'redis://redis:6379',
      CORS_ORIGIN: 'https://recovery.example.com',
      ADMIN_API_KEY: ADMIN,
      OPERATOR_API_KEY: OPERATOR,
      AUTH_ENABLED: 'true',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.AUTH_ENABLED).toBe(true);
  });

  it('rejects an API key too short to be a real secret', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://user:pass@db:5432/db',
        REDIS_URL: 'redis://redis:6379',
        ADMIN_API_KEY: 'short',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});

describe('authorization policy (Phase 14 §1)', () => {
  it('is deny-by-default: an unmapped route requires admin', () => {
    expect(requiredRoles('POST', '/api/something-nobody-thought-about')).toEqual(['admin']);
  });

  it('only health endpoints are public', () => {
    expect(isPublic('/health')).toBe(true);
    expect(isPublic('/health/ready')).toBe(true);
    expect(isPublic('/api/payments')).toBe(false);
    expect(isPublic('/api/demo/reset')).toBe(false);
  });

  it('keeps the demo role away from real operations', () => {
    expect(requiredRoles('POST', '/api/demo/reset')).toContain('demo');
    expect(requiredRoles('POST', '/api/human-review/f1/resolve')).not.toContain('demo');
    expect(requiredRoles('POST', '/api/payments/failures/f1/decide')).not.toContain('demo');
  });

  it('reserves running an experiment for admins', () => {
    expect(requiredRoles('POST', '/api/evaluations')).toEqual(['admin']);
    expect(requiredRoles('GET', '/api/evaluations/eval_1')).toContain('operator');
  });
});

describe('authentication enforcement', () => {
  it('lets health probes through unauthenticated', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
  });

  it('rejects a protected route with no token', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
    expect(res.statusCode).toBe(401);
    expect(res.json().status).toBe('UNAUTHENTICATED');
  });

  it('rejects an invalid token', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/summary',
      headers: bearer('not-the-key-0123456789abcdef'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a demo token on an operator route (403, not 401)', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_1/resolve',
      headers: bearer(DEMO),
      payload: { decision: 'KEEP_UNKNOWN' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().status).toBe('FORBIDDEN');
  });

  it('rejects an operator token on the admin-only experiment route', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/evaluations',
      headers: bearer(OPERATOR),
      payload: { seed: 1, count: 10 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts an admin token everywhere', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/evaluations',
      headers: bearer(ADMIN),
      payload: { seed: 1, count: 10 },
    });
    expect([200, 201]).toContain(res.statusCode);
  });

  it('accepts the x-api-key header as well as bearer', async () => {
    app = await buildApp(securedEnv);
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/human-review',
      headers: { 'x-api-key': OPERATOR },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('leaves the API open when auth is disabled (development default)', async () => {
    app = await buildApp(testEnv);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/human-review' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('transport hardening', () => {
  it('sets security headers', async () => {
    app = await buildApp(testEnv);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('returns a correlation id and echoes an inbound one', async () => {
    app = await buildApp(testEnv);
    await app.ready();

    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(generated.headers['x-request-id']).toBeTruthy();

    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('rejects a body over the configured limit', async () => {
    app = await buildApp(testEnv);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures',
      headers: { 'idempotency-key': 'k1' },
      payload: { blob: 'x'.repeat(testEnv.MAX_BODY_BYTES + 1024) },
    });
    expect(res.statusCode).toBe(413);
  });

  it('uses one consistent error envelope, with no stack trace', async () => {
    app = await buildApp(testEnv);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toMatchObject({ status: 'NOT_FOUND', statusCode: 404 });
    expect(body.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/\bat .*\.ts:\d+/);
  });
});
