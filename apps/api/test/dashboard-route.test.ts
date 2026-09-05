import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { DashboardReader, DashboardSummary } from '../src/dashboard/service';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

const fakeSummary: DashboardSummary = {
  funnel: { initiallyFailed: 10, classified: 10, eligible: 7, attempted: 6, recovered: 5 },
  recovery: {
    amountRecoveredMinor: 125000,
    attemptsConsumed: 9,
    messagesSent: 2,
    hardStops: 1,
    humanReview: 1,
    costPerRecoveryMinor: 500,
  },
  rootCauses: [
    { cause: 'ISSUER_TEMPORARY_FAILURE', count: 4, pct: 40 },
    { cause: 'CUSTOMER_FUNDS_LOW', count: 3, pct: 30 },
  ],
  actions: [
    { action: 'RETRY', count: 4, pct: 40 },
    { action: 'WAIT', count: 3, pct: 30 },
  ],
  recentActivity: [
    {
      id: 'aud_1',
      createdAt: '2026-09-04T10:00:00.000Z',
      paymentId: 'pay_1',
      eventType: 'FAILURE_CLASSIFIED',
      whatWeConcluded: 'Issuer temporary failure.',
      whatWeDid: 'Scheduled retry.',
    },
  ],
  costModel: { perAttemptMinor: 250, perMessageMinor: 20 },
};

function fakeReader(overrides: Partial<DashboardReader> = {}): DashboardReader {
  return { getSummary: async () => fakeSummary, ...overrides };
}

describe('GET /api/dashboard/summary', () => {
  it('returns the aggregated summary from the injected reader', async () => {
    app = await buildApp(testEnv, { dashboardDeps: { reader: fakeReader() } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeSummary);
  });

  it('never hardcodes a value: the route only forwards what the reader computed', async () => {
    let calls = 0;
    const reader = fakeReader({
      getSummary: async () => {
        calls += 1;
        return { ...fakeSummary, recovery: { ...fakeSummary.recovery, humanReview: 42 } };
      },
    });
    app = await buildApp(testEnv, { dashboardDeps: { reader } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
    expect(res.json().recovery.humanReview).toBe(42);
    expect(calls).toBe(1);
  });

  it('is read-only', async () => {
    app = await buildApp(testEnv, { dashboardDeps: { reader: fakeReader() } });
    await app.ready();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/dashboard/summary' });
      expect(res.statusCode).toBe(404);
    }
  });
});
