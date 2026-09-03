import { prismaClient } from '@recovery-desk/db';
import { createSimulator } from '@recovery-desk/simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideRecovery } from '../src/decide-service';
import { enqueueRecoveryAction } from '../src/enqueue-service';
import { executeRecoveryAction } from '../src/execute-service';
import { createRecoveryQueue, createRecoveryWorker } from '../src/queue';
import {
  closeRecoveryQueue,
  liveDecideDeps,
  liveEnqueueDeps,
  liveExecuteDeps,
} from '../src/live-deps';

/**
 * The real pipeline against real Postgres + Redis + BullMQ, with the mock
 * gateway swapped into the worker. Skipped automatically when the services are
 * not configured (CI without infra). Run it with:
 *
 *   docker compose up -d
 *   pnpm --filter @recovery-desk/recovery test
 */
const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const suite = hasInfra ? describe : describe.skip;

suite('recovery pipeline (integration)', () => {
  const ids = { customer: '', payment: '', failure: '', classification: '', action: '' };

  beforeAll(async () => {
    await prismaClient.$connect();
    // clear any stale jobs from a previous run
    const q = createRecoveryQueue(process.env.REDIS_URL as string);
    await q.obliterate({ force: true }).catch(() => undefined);
    await q.close();

    const customer = await prismaClient.customer.create({
      data: {
        name: 'Pipeline IT',
        email: `pipeline+${Date.now()}@recovery-desk.test`,
        salaryDay: 1,
      },
    });
    ids.customer = customer.id;

    const payment = await prismaClient.payment.create({
      data: {
        customerId: customer.id,
        amount: '3200.00',
        currency: 'INR',
        method: 'CARD',
        status: 'FAILED',
        recoveryStatus: 'CLASSIFIED',
        attemptCount: 1,
      },
    });
    ids.payment = payment.id;

    const failure = await prismaClient.paymentFailure.create({
      data: {
        paymentId: payment.id,
        errorCode: 'GATEWAY_ERROR',
        errorReason: 'issuer_timeout',
        errorSource: 'BANK',
        errorStep: 'AUTHORIZATION',
        errorDescription: 'Issuer did not respond in the authorization window',
        idempotencyKey: `it-fail-${Date.now()}`,
      },
    });
    ids.failure = failure.id;

    const classification = await prismaClient.classification.create({
      data: {
        failureId: failure.id,
        cause: 'ISSUER_TEMPORARY_FAILURE',
        confidence: 0.94,
        ruleId: 'ISSUER_TEMP_001',
        classifierVersion: 'it',
        source: 'RULE',
        evidence: ['reason=issuer_timeout'],
      },
    });
    ids.classification = classification.id;
  }, 30_000);

  afterAll(async () => {
    await closeRecoveryQueue().catch(() => undefined);
    if (ids.payment) {
      await prismaClient.recoveryOutcome.deleteMany({
        where: { action: { paymentId: ids.payment } },
      });
      await prismaClient.recoveryAction.deleteMany({ where: { paymentId: ids.payment } });
      await prismaClient.classification.deleteMany({
        where: { failure: { paymentId: ids.payment } },
      });
      await prismaClient.paymentFailure.deleteMany({ where: { paymentId: ids.payment } });
      await prismaClient.auditEvent.deleteMany({ where: { paymentId: ids.payment } });
      await prismaClient.payment.deleteMany({ where: { id: ids.payment } });
    }
    if (ids.customer) await prismaClient.customer.deleteMany({ where: { id: ids.customer } });
    await prismaClient.$disconnect();
  }, 30_000);

  it('decide -> enqueue -> worker -> Mock Gateway -> SUCCEEDED', async () => {
    // POST /decide
    const decided = await decideRecovery(ids.failure, liveDecideDeps);
    expect(decided.status).toBe('DECIDED');
    if (decided.status !== 'DECIDED') return;
    expect(decided.decision.action).toBe('RETRY');
    ids.action = decided.action.id;

    // POST /enqueue (immediate so the test does not wait 18 minutes)
    const enq = await enqueueRecoveryAction(ids.action, liveEnqueueDeps, { immediate: true });
    expect(enq.status).toBe('ENQUEUED');

    // Recovery worker with the mock gateway
    const worker = createRecoveryWorker(
      process.env.REDIS_URL as string,
      async (job) =>
        executeRecoveryAction(job.data.actionId, {
          ...liveExecuteDeps,
          gateway: createSimulator({ recoversOnAttempt: 2 }),
        }),
      { concurrency: 1 },
    );

    try {
      const completed = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timeout')), 20_000);
        worker.on('completed', (_job, result) => {
          clearTimeout(timer);
          resolve(result as Record<string, unknown>);
        });
        worker.on('failed', (_job, err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      expect(completed.status).toBe('EXECUTED_SUCCESS');
    } finally {
      await worker.close();
    }

    // Outcome + payment + audit
    const outcome = await prismaClient.recoveryOutcome.findFirst({
      where: { actionId: ids.action },
    });
    expect(outcome?.status).toBe('SUCCESS');
    expect(Number(outcome?.amountRecovered)).toBe(3200);

    const payment = await prismaClient.payment.findUnique({ where: { id: ids.payment } });
    expect(payment?.status).toBe('SUCCEEDED');
    expect(payment?.recoveryStatus).toBe('RECOVERED');
    expect(payment?.attemptCount).toBe(2);

    const events = await prismaClient.auditEvent.findMany({
      where: { paymentId: ids.payment },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'POLICY_DECISION',
      'RECOVERY_ENQUEUED',
      'RECOVERY_EXECUTED',
    ]);
  }, 40_000);
});
