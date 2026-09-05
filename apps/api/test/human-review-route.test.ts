import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type {
  HumanReviewService,
  PendingReviewItem,
  ResolveReviewResult,
} from '../src/human-review/service';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

const pending: PendingReviewItem = {
  paymentId: 'pay_2018',
  amountMinor: 840000,
  currency: 'INR',
  failureId: 'fail_2018',
  errorCode: 'UNKNOWN_ERROR',
  errorReason: 'processor_rejected',
  errorDescription: 'Transaction declined by upstream processor.',
  currentCause: 'UNKNOWN',
  currentConfidence: 0.3,
  aiSuggestion: {
    classificationId: 'cls_ai_1',
    cause: 'ISSUER_TEMPORARY_FAILURE',
    confidence: 0.71,
    explanation: 'Description mentions an upstream timeout pattern.',
    createdAt: '2026-09-04T10:05:00.000Z',
  },
  enteredReviewAt: '2026-09-04T10:00:00.000Z',
};

function fakeService(overrides: Partial<HumanReviewService> = {}): HumanReviewService {
  return {
    listPending: async () => [pending],
    resolve: async () =>
      ({ status: 'RESOLVED', duplicate: false, classificationId: 'cls_h1', cause: 'ISSUER_TEMPORARY_FAILURE' }) as ResolveReviewResult,
    ...overrides,
  };
}

describe('GET /api/human-review', () => {
  it('lists pending reviews with the AI suggestion attached', async () => {
    app = await buildApp(testEnv, { humanReviewDeps: { service: fakeService() } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/human-review' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 1, items: [pending] });
  });

  it('never includes an action/schedule/execute field for a pending review', async () => {
    app = await buildApp(testEnv, { humanReviewDeps: { service: fakeService() } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/human-review' });
    const item = res.json().items[0];
    expect(item).not.toHaveProperty('action');
    expect(item).not.toHaveProperty('scheduledFor');
  });
});

describe('POST /api/human-review/:failureId/resolve', () => {
  it('accepts the AI suggestion', async () => {
    const resolve = vi.fn(async () =>
      ({ status: 'RESOLVED', duplicate: false, classificationId: 'cls_h1', cause: 'ISSUER_TEMPORARY_FAILURE' }) as ResolveReviewResult,
    );
    app = await buildApp(testEnv, { humanReviewDeps: { service: fakeService({ resolve }) } });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_2018/resolve',
      payload: { decision: 'ACCEPT', rootCause: 'ISSUER_TEMPORARY_FAILURE', reason: 'Matches issuer timeout pattern.' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      status: 'RESOLVED',
      duplicate: false,
      classificationId: 'cls_h1',
      cause: 'ISSUER_TEMPORARY_FAILURE',
    });
    expect(resolve).toHaveBeenCalledWith({
      failureId: 'fail_2018',
      decision: 'ACCEPT',
      rootCause: 'ISSUER_TEMPORARY_FAILURE',
      reason: 'Matches issuer timeout pattern.',
    });
  });

  it('rejects ACCEPT without a rootCause', async () => {
    const service = fakeService({
      resolve: async () => ({ status: 'ROOT_CAUSE_REQUIRED' }) as ResolveReviewResult,
    });
    app = await buildApp(testEnv, { humanReviewDeps: { service } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_2018/resolve',
      payload: { decision: 'ACCEPT' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().status).toBe('ROOT_CAUSE_REQUIRED');
  });

  it('keeps as unknown without requiring a rootCause', async () => {
    const resolve = vi.fn(async () =>
      ({ status: 'RESOLVED', duplicate: false, classificationId: 'cls_h2', cause: 'UNKNOWN' }) as ResolveReviewResult,
    );
    app = await buildApp(testEnv, { humanReviewDeps: { service: fakeService({ resolve }) } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_2018/resolve',
      payload: { decision: 'KEEP_UNKNOWN' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cause).toBe('UNKNOWN');
  });

  it('is idempotent: a second resolution returns DUPLICATE', async () => {
    const service = fakeService({
      resolve: async () =>
        ({ status: 'DUPLICATE', duplicate: true, classificationId: 'cls_h1', cause: 'ISSUER_TEMPORARY_FAILURE' }) as ResolveReviewResult,
    });
    app = await buildApp(testEnv, { humanReviewDeps: { service } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_2018/resolve',
      payload: { decision: 'ACCEPT', rootCause: 'ISSUER_TEMPORARY_FAILURE' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DUPLICATE');
  });

  it('404s for an unknown failure', async () => {
    const service = fakeService({ resolve: async () => ({ status: 'FAILURE_NOT_FOUND' }) as ResolveReviewResult });
    app = await buildApp(testEnv, { humanReviewDeps: { service } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/missing/resolve',
      payload: { decision: 'KEEP_UNKNOWN' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid decision', async () => {
    app = await buildApp(testEnv, { humanReviewDeps: { service: fakeService() } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/human-review/fail_2018/resolve',
      payload: { decision: 'MAYBE' },
    });
    expect(res.statusCode).toBe(400);
  });
});
