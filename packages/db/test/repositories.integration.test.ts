import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaClient } from '../src/client';
import { createRepositories } from '../src/repositories';
import { withTransaction } from '../src/transaction';

/**
 * Integration test — needs a migrated Postgres running (docker compose up -d,
 * pnpm --filter @recovery-desk/db migrate). Skipped automatically when
 * DATABASE_URL is not set (e.g. CI without a database).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const repos = createRepositories();
const createdCustomerIds: string[] = [];

suite('persistence layer', () => {
  beforeAll(async () => {
    await prismaClient.$connect();
  });

  afterAll(async () => {
    // FK-safe teardown: children first, Payment -> Customer is onDelete: Restrict.
    for (const customerId of createdCustomerIds) {
      const payments = await prismaClient.payment.findMany({ where: { customerId } });
      const paymentIds = payments.map((p) => p.id);
      await prismaClient.recoveryOutcome.deleteMany({
        where: { action: { paymentId: { in: paymentIds } } },
      });
      await prismaClient.recoveryAction.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prismaClient.classification.deleteMany({
        where: { failure: { paymentId: { in: paymentIds } } },
      });
      await prismaClient.paymentFailure.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prismaClient.auditEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prismaClient.payment.deleteMany({ where: { customerId } });
      await prismaClient.customer.delete({ where: { id: customerId } });
    }
    await prismaClient.$disconnect();
  });

  it('persists a full failure -> classification -> action -> outcome -> audit chain', async () => {
    const email = `it+${Date.now()}@recovery-desk.test`;

    const customer = await repos.customers.create({
      name: 'Integration Test',
      email,
      balanceState: 'LOW',
      salaryDay: 1,
      preferredLanguage: 'HINGLISH',
    });
    createdCustomerIds.push(customer.id);

    const payment = await repos.payments.create({
      customerId: customer.id,
      amount: '2500.00',
      method: 'CARD',
      status: 'FAILED',
      recoveryStatus: 'FAILED',
      attemptCount: 1,
    });

    const failure = await repos.paymentFailures.create({
      paymentId: payment.id,
      errorCode: 'BAD_REQUEST_ERROR',
      errorReason: 'issuer_timeout',
      errorSource: 'BANK',
      errorStep: 'AUTHORIZATION',
      errorDescription: 'Issuer authorization timeout',
      rawPayload: { code: 'BAD_REQUEST_ERROR', reason: 'issuer_timeout' },
      idempotencyKey: `it-key-${Date.now()}`,
    });

    const classification = await repos.classifications.create({
      failureId: failure.id,
      cause: 'ISSUER_TEMPORARY_FAILURE',
      confidence: 0.97,
      ruleId: 'BANK_TIMEOUT_001',
      classifierVersion: 'v0-test',
      source: 'RULE',
      evidence: ['source=bank', 'reason=timeout', 'step=authorization'],
    });
    expect(classification.evidence).toHaveLength(3);

    const action = await repos.recoveryActions.create({
      paymentId: payment.id,
      cause: 'ISSUER_TEMPORARY_FAILURE',
      action: 'RETRY',
      status: 'SCHEDULED',
      attemptNumber: 2,
      scheduledFor: new Date(Date.now() + 18 * 60_000),
      reason: 'Temporary issuer failure — retry after 18 minutes',
      delayMinutes: 18,
      maxAttempts: 3,
      idempotencyKey: `it-action-${Date.now()}`,
    });

    const due = await repos.recoveryActions.listDue(new Date(Date.now() + 60 * 60_000));
    expect(due.some((a) => a.id === action.id)).toBe(true);

    await repos.recoveryActions.markExecuted(action.id);
    const outcome = await repos.recoveryOutcomes.create({
      actionId: action.id,
      status: 'SUCCESS',
      amountRecovered: '2500.00',
      gatewayLatencyMs: 812,
    });
    expect(outcome.status).toBe('SUCCESS');

    await repos.auditEvents.append({
      paymentId: payment.id,
      eventType: 'RECOVERY_EXECUTED',
      whatWeSaw: 'Bank authorization timeout.',
      whatWeConcluded: 'Temporary issuer failure.',
      whatWasAllowed: 'Retry after 18 minutes, max 3 attempts.',
      whatWeDid: 'Scheduled and executed retry.',
      whatHappened: 'Payment recovered.',
      metadata: { actionId: action.id },
    });

    const hydrated = await repos.payments.findByIdWithRelations(payment.id);
    expect(hydrated?.customer.email).toBe(email);
    expect(hydrated?.failures).toHaveLength(1);
    expect(hydrated?.recoveryActions[0]?.outcome?.status).toBe('SUCCESS');

    const timeline = await repos.auditEvents.listByPayment(payment.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.whatHappened).toBe('Payment recovered.');
  });

  it('enforces idempotency-key uniqueness on payment_failures', async () => {
    const email = `it-dup+${Date.now()}@recovery-desk.test`;
    const customer = await repos.customers.create({ name: 'Dup Test', email });
    createdCustomerIds.push(customer.id);
    const payment = await repos.payments.create({
      customerId: customer.id,
      amount: '100.00',
      method: 'UPI',
    });

    const key = `dup-key-${Date.now()}`;
    await repos.paymentFailures.create({
      paymentId: payment.id,
      errorCode: 'X',
      errorReason: 'upi_collect_timeout',
      errorSource: 'GATEWAY',
      errorStep: 'AUTHORIZATION',
      errorDescription: 'UPI collect timed out',
      idempotencyKey: key,
    });

    await expect(
      repos.paymentFailures.create({
        paymentId: payment.id,
        errorCode: 'X',
        errorReason: 'upi_collect_timeout',
        errorSource: 'GATEWAY',
        errorStep: 'AUTHORIZATION',
        errorDescription: 'UPI collect timed out',
        idempotencyKey: key,
      }),
    ).rejects.toThrow();
  });

  it('rolls back a transaction on error', async () => {
    const email = `it-tx+${Date.now()}@recovery-desk.test`;
    let customerId: string | undefined;

    await expect(
      withTransaction(async (tx) => {
        const txRepos = createRepositories(tx);
        const customer = await txRepos.customers.create({ name: 'Tx Test', email });
        customerId = customer.id;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(customerId).toBeDefined();
    const persisted = await repos.customers.findByEmail(email);
    expect(persisted).toBeNull();
  });
});
