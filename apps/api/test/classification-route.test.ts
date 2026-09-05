import { Prisma } from '@recovery-desk/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type {
  ClassifyFailureDeps,
  FailureContext,
  PersistArgs,
  StoredClassification,
} from '../src/classification/service';
import { testEnv } from './_env';

const FUNDS_LOW_FAILURE: FailureContext = {
  failureId: 'fail_seed_1',
  paymentId: 'pay_seed_1',
  errorCode: 'BAD_REQUEST_ERROR',
  errorReason: 'insufficient_funds',
  errorSource: 'BANK',
  errorStep: 'AUTHORIZATION',
  errorDescription: 'Insufficient funds in account',
  method: 'CARD',
  paymentRecoveryStatus: 'FAILED',
};

interface FakeDeps extends ClassifyFailureDeps {
  rows: StoredClassification[];
  readonly auditEvents: number;
  recoveryStatusOf: (paymentId: string) => string | null;
}

/** In-memory stand-in for the DB-backed deps. */
function makeFakeDeps(
  overrides: {
    failures?: Record<string, FailureContext>;
    /**
     * Number of leading `findExistingClassification` calls that return null even
     * when a row exists — simulates a lost idempotency race so the unique-index
     * (P2002) path in the service is exercised.
     */
    staleReads?: number;
  } = {},
): FakeDeps {
  const failures = overrides.failures ?? { [FUNDS_LOW_FAILURE.failureId]: FUNDS_LOW_FAILURE };
  const rows: StoredClassification[] = [];
  const recoveryStatus = new Map<string, string | null>();
  const store = new Map<string, StoredClassification>();
  let auditEvents = 0;
  let seq = 0;
  let staleReadsRemaining = overrides.staleReads ?? 0;

  const key = (failureId: string, v: string) => `${failureId}::${v}`;

  return {
    rows,
    get auditEvents() {
      return auditEvents;
    },
    recoveryStatusOf: (paymentId) => recoveryStatus.get(paymentId) ?? null,

    async loadFailureContext(failureId) {
      return failures[failureId] ?? null;
    },

    async findExistingClassification(failureId, version) {
      if (staleReadsRemaining > 0) {
        staleReadsRemaining -= 1;
        return null;
      }
      return store.get(key(failureId, version)) ?? null;
    },

    async persistClassification({ failure, result }: PersistArgs) {
      const k = key(failure.failureId, result.classifierVersion);
      if (store.has(k)) {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      seq += 1;
      const row: StoredClassification = {
        id: `cls_${seq}`,
        failureId: failure.failureId,
        cause: result.cause,
        confidence: result.confidence,
        ruleId: result.ruleId,
        classifierVersion: result.classifierVersion,
        source: 'RULE',
        evidence: result.evidence,
        explanation: result.explanation,
        createdAt: new Date('2026-09-03T00:00:00Z'),
      };
      store.set(k, row);
      rows.push(row);
      auditEvents += 1;
      if (failure.paymentRecoveryStatus === 'FAILED') {
        recoveryStatus.set(failure.paymentId, 'CLASSIFIED');
      }
      return row;
    },
  };
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function start(deps: ClassifyFailureDeps): Promise<FastifyInstance> {
  app = await buildApp(testEnv, { classificationDeps: deps });
  await app.ready();
  return app;
}

describe('POST /api/payments/failures/:failureId/classify', () => {
  it('classifies a seeded funds-low failure: 201, cause, confidence, explanation', async () => {
    const deps = makeFakeDeps();
    await start(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/fail_seed_1/classify',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('CLASSIFIED');
    expect(body.duplicate).toBe(false);
    expect(body.cause).toBe('CUSTOMER_FUNDS_LOW');
    expect(body.confidence).toBe(0.98);
    expect(body.ruleId).toBe('FUNDS_LOW_001');
    expect(typeof body.explanation).toBe('string');
    expect(body.explanation.toLowerCase()).toContain('enough');
    expect(body.classificationId).toBe('cls_1');

    expect(deps.rows).toHaveLength(1);
    expect(deps.auditEvents).toBe(1);
    expect(deps.recoveryStatusOf('pay_seed_1')).toBe('CLASSIFIED');
  });

  it('is idempotent: second call returns 200 DUPLICATE, no new row, no new audit event', async () => {
    const deps = makeFakeDeps();
    await start(deps);

    const first = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/fail_seed_1/classify',
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/fail_seed_1/classify',
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('DUPLICATE');
    expect(second.json().duplicate).toBe(true);
    expect(second.json().classificationId).toBe(first.json().classificationId);

    expect(deps.rows).toHaveLength(1);
    expect(deps.auditEvents).toBe(1);
  });

  it('404s when the failure does not exist', async () => {
    const deps = makeFakeDeps();
    await start(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/nope/classify',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().status).toBe('FAILURE_NOT_FOUND');
    expect(deps.rows).toHaveLength(0);
  });

  it('treats a concurrent unique-constraint hit (P2002) as a DUPLICATE, not an error', async () => {
    // First two idempotency pre-checks read stale (null); the post-P2002
    // re-read sees the row.
    const deps = makeFakeDeps({ staleReads: 2 });
    await start(deps);

    const first = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/fail_seed_1/classify',
    });
    // Second insert throws P2002; service must re-read and return DUPLICATE.
    const second = await app.inject({
      method: 'POST',
      url: '/api/payments/failures/fail_seed_1/classify',
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('DUPLICATE');
    expect(deps.rows).toHaveLength(1);
  });
});
