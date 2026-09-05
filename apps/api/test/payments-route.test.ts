import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type { PaymentDetail, PaymentListFilters, PaymentListResult, PaymentsReader } from '../src/payments/service';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

const fakeList: PaymentListResult = {
  items: [
    {
      paymentId: 'pay_1',
      amountMinor: 250000,
      currency: 'INR',
      method: 'UPI',
      status: 'RECOVERING',
      recoveryStatus: 'SCHEDULED',
      attemptCount: 1,
      cause: 'ISSUER_TEMPORARY_FAILURE',
      confidence: 0.97,
      action: 'RETRY',
      actionStatus: 'SCHEDULED',
      maxAttempts: 3,
      scheduledFor: '2026-09-04T10:30:00.000Z',
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:04.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

const fakeDetail: PaymentDetail = {
  payment: {
    id: 'pay_1',
    amountMinor: 250000,
    currency: 'INR',
    method: 'UPI',
    status: 'RECOVERING',
    recoveryStatus: 'SCHEDULED',
    attemptCount: 1,
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:04.000Z',
  },
  customer: { id: 'cust_1', name: 'Asha Menon', balanceState: 'LOW', salaryDay: 1 },
  failures: [],
  recoveryActions: [],
  messages: [],
  auditTimeline: [],
};

function fakeReader(overrides: Partial<PaymentsReader> = {}): PaymentsReader {
  return {
    list: async (_filters: PaymentListFilters) => fakeList,
    detail: async (id: string) => (id === 'pay_1' ? fakeDetail : null),
    ...overrides,
  };
}

describe('GET /api/payments', () => {
  it('lists payments and forwards query filters to the reader', async () => {
    const list = vi.fn(async () => fakeList);
    app = await buildApp(testEnv, { paymentsDeps: { reader: fakeReader({ list }) } });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/payments?status=SCHEDULED&cause=ISSUER_TEMPORARY_FAILURE&limit=10',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeList);
    expect(list).toHaveBeenCalledWith({
      status: 'SCHEDULED',
      cause: 'ISSUER_TEMPORARY_FAILURE',
      limit: 10,
    });
  });

  it('rejects an invalid status filter', async () => {
    app = await buildApp(testEnv, { paymentsDeps: { reader: fakeReader() } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/payments?status=NOT_A_STATUS' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/payments/:paymentId', () => {
  it('returns full detail for a known payment', async () => {
    app = await buildApp(testEnv, { paymentsDeps: { reader: fakeReader() } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/payments/pay_1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeDetail);
  });

  it('404s for an unknown payment', async () => {
    app = await buildApp(testEnv, { paymentsDeps: { reader: fakeReader() } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/payments/pay_missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json().status).toBe('NOT_FOUND');
  });
});
