import { prismaClient } from '../src/client';
import { withTransaction, type TransactionClient } from '../src/transaction';

/**
 * Minimal development seed.
 *
 * This is NOT the ~500-failure experiment dataset (that is generated
 * deterministically in Phase 5). It inserts a small, hand-written set of rows
 * that exercises every Phase 3 table and the full pipeline shape:
 *
 *   customer -> payment -> payment_failure -> classification
 *            -> recovery_action -> recovery_outcome
 *            -> audit_events (append-only)
 *
 * The rows cover four representative recovery paths:
 *   pay_1001  funds low        -> WAIT for salary window   (scheduled)
 *   pay_1002  issuer timeout   -> RETRY after 18m          (recovered)
 *   pay_1003  mandate revoked  -> HARD_STOP                (blocked)
 *   pay_1004  unknown failure  -> HUMAN_REVIEW             (pending)
 *
 * Every id is a fixed, readable string so the seed is idempotent (re-running
 * deletes exactly these rows and recreates them) and easy to reference while
 * developing later phases.
 */

// A fixed clock so timestamps are reproducible across runs.
const BASE = new Date('2026-09-03T09:00:00.000+05:30');
const at = (minutesFromBase: number): Date => new Date(BASE.getTime() + minutesFromBase * 60_000);

const CUSTOMER_IDS = ['cust_asha', 'cust_rohan', 'cust_meera'];
const PAYMENT_IDS = ['pay_1001', 'pay_1002', 'pay_1003', 'pay_1004'];
const FAILURE_IDS = ['fail_1001', 'fail_1002', 'fail_1003', 'fail_1004'];
const CLASSIFICATION_IDS = ['cls_1001', 'cls_1002', 'cls_1003', 'cls_1004'];
const ACTION_IDS = ['act_1001', 'act_1002', 'act_1003', 'act_1004'];
const OUTCOME_IDS = ['out_1002', 'out_1003'];
const AUDIT_IDS = [
  'aud_1001_1',
  'aud_1002_1',
  'aud_1002_2',
  'aud_1002_3',
  'aud_1003_1',
  'aud_1004_1',
];

async function clearSeed(tx: TransactionClient): Promise<void> {
  // Child rows first so foreign keys stay satisfied.
  await tx.auditEvent.deleteMany({ where: { id: { in: AUDIT_IDS } } });
  await tx.recoveryOutcome.deleteMany({ where: { id: { in: OUTCOME_IDS } } });
  await tx.recoveryAction.deleteMany({ where: { id: { in: ACTION_IDS } } });
  await tx.classification.deleteMany({ where: { id: { in: CLASSIFICATION_IDS } } });
  await tx.paymentFailure.deleteMany({ where: { id: { in: FAILURE_IDS } } });
  await tx.payment.deleteMany({ where: { id: { in: PAYMENT_IDS } } });
  await tx.customer.deleteMany({ where: { id: { in: CUSTOMER_IDS } } });
}

async function main(): Promise<void> {
  await withTransaction(async (tx) => {
    await clearSeed(tx);

    // ---- customers ----------------------------------------------------------
    await tx.customer.createMany({
      data: [
        {
          id: 'cust_asha',
          name: 'Asha Menon',
          email: 'asha.menon@example.in',
          phone: '+91 98200 11111',
          balanceState: 'LOW',
          salaryDay: 1,
          preferredLanguage: 'HINGLISH',
        },
        {
          id: 'cust_rohan',
          name: 'Rohan Gupta',
          email: 'rohan.gupta@example.in',
          phone: '+91 99300 22222',
          balanceState: 'HEALTHY',
          salaryDay: 7,
          preferredLanguage: 'EN',
        },
        {
          id: 'cust_meera',
          name: 'Meera Nair',
          email: 'meera.nair@example.in',
          phone: '+91 90400 33333',
          balanceState: 'CRITICAL',
          salaryDay: 1,
          preferredLanguage: 'HI',
        },
      ],
    });

    // ---- payments ---------------------------------------------------------
    await tx.payment.createMany({
      data: [
        {
          id: 'pay_1001',
          customerId: 'cust_asha',
          amount: '2500.00',
          currency: 'INR',
          method: 'UPI',
          status: 'RECOVERING',
          recoveryStatus: 'SCHEDULED',
          attemptCount: 1,
          createdAt: at(0),
        },
        {
          id: 'pay_1002',
          customerId: 'cust_rohan',
          amount: '1799.00',
          currency: 'INR',
          method: 'CARD',
          status: 'SUCCEEDED',
          recoveryStatus: 'RECOVERED',
          attemptCount: 2,
          createdAt: at(0),
        },
        {
          id: 'pay_1003',
          customerId: 'cust_meera',
          amount: '8000.00',
          currency: 'INR',
          method: 'MANDATE',
          status: 'HARD_STOPPED',
          recoveryStatus: 'HARD_STOPPED',
          attemptCount: 1,
          createdAt: at(0),
        },
        {
          id: 'pay_1004',
          customerId: 'cust_rohan',
          amount: '1200.00',
          currency: 'INR',
          method: 'NETBANKING',
          status: 'FAILED',
          recoveryStatus: 'HUMAN_REVIEW',
          attemptCount: 1,
          createdAt: at(0),
        },
      ],
    });

    // ---- payment_failures -------------------------------------------------
    await tx.paymentFailure.createMany({
      data: [
        {
          id: 'fail_1001',
          paymentId: 'pay_1001',
          errorCode: 'BAD_REQUEST_ERROR',
          errorReason: 'insufficient_funds',
          errorSource: 'CUSTOMER',
          errorStep: 'AUTHORIZATION',
          errorDescription: 'Insufficient balance in customer account',
          rawPayload: {
            error: {
              code: 'BAD_REQUEST_ERROR',
              reason: 'insufficient_funds',
              source: 'customer',
              step: 'payment_authorization',
              description: 'Insufficient balance in customer account',
            },
          },
          idempotencyKey: 'seed-fail-1001',
          occurredAt: at(1),
        },
        {
          id: 'fail_1002',
          paymentId: 'pay_1002',
          errorCode: 'GATEWAY_ERROR',
          errorReason: 'issuer_timeout',
          errorSource: 'BANK',
          errorStep: 'AUTHORIZATION',
          errorDescription: 'Issuer did not respond within the authorization window',
          rawPayload: {
            error: {
              code: 'GATEWAY_ERROR',
              reason: 'issuer_timeout',
              source: 'bank',
              step: 'payment_authorization',
              description: 'Issuer did not respond within the authorization window',
            },
          },
          idempotencyKey: 'seed-fail-1002',
          occurredAt: at(2),
        },
        {
          id: 'fail_1003',
          paymentId: 'pay_1003',
          errorCode: 'BAD_REQUEST_ERROR',
          errorReason: 'mandate_revoked',
          errorSource: 'BUSINESS',
          errorStep: 'AUTHORIZATION',
          errorDescription: 'Customer has revoked the e-mandate for this subscription',
          rawPayload: {
            error: {
              code: 'BAD_REQUEST_ERROR',
              reason: 'mandate_revoked',
              source: 'business',
              step: 'payment_authorization',
              description: 'Customer has revoked the e-mandate for this subscription',
            },
          },
          idempotencyKey: 'seed-fail-1003',
          occurredAt: at(3),
        },
        {
          id: 'fail_1004',
          paymentId: 'pay_1004',
          errorCode: 'GATEWAY_ERROR',
          errorReason: 'authorization_response_mismatch',
          errorSource: 'GATEWAY',
          errorStep: 'AUTHORIZATION',
          errorDescription: 'Authorization response could not be reconciled with the request',
          rawPayload: {
            error: {
              code: 'GATEWAY_ERROR',
              reason: 'authorization_response_mismatch',
              source: 'gateway',
              step: 'payment_authorization',
              description: 'Authorization response could not be reconciled with the request',
            },
          },
          idempotencyKey: 'seed-fail-1004',
          occurredAt: at(4),
        },
      ],
    });

    // ---- classifications (deterministic classifier, v1) -----------------
    await tx.classification.createMany({
      data: [
        {
          id: 'cls_1001',
          failureId: 'fail_1001',
          cause: 'CUSTOMER_FUNDS_LOW',
          confidence: 0.98,
          ruleId: 'FUNDS_LOW_001',
          classifierVersion: 'v1',
          source: 'RULE',
          evidence: ['reason=insufficient_funds', 'source=customer', 'step=authorization'],
          createdAt: at(1),
        },
        {
          id: 'cls_1002',
          failureId: 'fail_1002',
          cause: 'ISSUER_TEMPORARY_FAILURE',
          confidence: 0.97,
          ruleId: 'BANK_TIMEOUT_001',
          classifierVersion: 'v1',
          source: 'RULE',
          evidence: ['source=bank', 'reason=issuer_timeout', 'step=authorization'],
          createdAt: at(2),
        },
        {
          id: 'cls_1003',
          failureId: 'fail_1003',
          cause: 'MANDATE_INVALID',
          confidence: 0.99,
          ruleId: 'MANDATE_REVOKED_001',
          classifierVersion: 'v1',
          source: 'RULE',
          evidence: ['reason=mandate_revoked', 'source=business'],
          createdAt: at(3),
        },
        {
          id: 'cls_1004',
          failureId: 'fail_1004',
          cause: 'UNKNOWN',
          confidence: 0.3,
          ruleId: null,
          classifierVersion: 'v1',
          source: 'RULE',
          evidence: ['no matching rule', 'reason=authorization_response_mismatch'],
          createdAt: at(4),
        },
      ],
    });

    // ---- recovery_actions (policy decisions) ----------------------------
    await tx.recoveryAction.createMany({
      data: [
        {
          id: 'act_1001',
          paymentId: 'pay_1001',
          cause: 'CUSTOMER_FUNDS_LOW',
          action: 'WAIT',
          status: 'SCHEDULED',
          attemptNumber: 2,
          scheduledFor: at(24 * 60), // next day, approaching the salary window
          reason: 'Funds low: wait for the expected salary-day balance top-up before retrying',
          delayMinutes: 24 * 60,
          maxAttempts: 3,
          idempotencyKey: 'seed-act-1001',
          createdAt: at(1),
        },
        {
          id: 'act_1002',
          paymentId: 'pay_1002',
          cause: 'ISSUER_TEMPORARY_FAILURE',
          action: 'RETRY',
          status: 'EXECUTED',
          attemptNumber: 2,
          scheduledFor: at(20),
          reason: 'Temporary issuer failure: retry once after an 18-minute cooldown',
          delayMinutes: 18,
          maxAttempts: 3,
          idempotencyKey: 'seed-act-1002',
          createdAt: at(2),
          executedAt: at(20),
        },
        {
          id: 'act_1003',
          paymentId: 'pay_1003',
          cause: 'MANDATE_INVALID',
          action: 'HARD_STOP',
          status: 'EXECUTED',
          attemptNumber: 1,
          reason: 'Mandate revoked: hard stop, cancel all current and future retries',
          maxAttempts: 0,
          idempotencyKey: 'seed-act-1003',
          createdAt: at(3),
          executedAt: at(3),
        },
        {
          id: 'act_1004',
          paymentId: 'pay_1004',
          cause: 'UNKNOWN',
          action: 'HUMAN_REVIEW',
          status: 'PENDING',
          attemptNumber: 1,
          reason: 'Unknown failure: never auto-retry, route to the human review queue',
          idempotencyKey: 'seed-act-1004',
          createdAt: at(4),
        },
      ],
    });

    // ---- recovery_outcomes (only for executed actions) -----------------
    await tx.recoveryOutcome.createMany({
      data: [
        {
          id: 'out_1002',
          actionId: 'act_1002',
          status: 'SUCCESS',
          amountRecovered: '1799.00',
          gatewayLatencyMs: 820,
          occurredAt: at(20),
        },
        {
          id: 'out_1003',
          actionId: 'act_1003',
          status: 'BLOCKED',
          amountRecovered: '0.00',
          failureReason: 'Hard stop enforced: mandate revoked',
          occurredAt: at(3),
        },
      ],
    });

    // ---- audit_events (append-only 5-part records) ---------------------
    await tx.auditEvent.createMany({
      data: [
        {
          id: 'aud_1001_1',
          paymentId: 'pay_1001',
          eventType: 'RECOVERY_SCHEDULED',
          whatWeSaw: 'UPI payment of INR 2500 failed with reason=insufficient_funds (source=customer).',
          whatWeConcluded: 'Customer funds low (rule FUNDS_LOW_001, confidence 0.98).',
          whatWasAllowed: 'WAIT and retry inside the salary-day balance window; max 3 attempts.',
          whatWeDid: 'Scheduled attempt 2 for the next salary window (T+24h).',
          whatHappened: 'Action queued; awaiting the scheduled time.',
          metadata: { failureId: 'fail_1001', actionId: 'act_1001' },
          createdAt: at(1),
        },
        {
          id: 'aud_1002_1',
          paymentId: 'pay_1002',
          eventType: 'FAILURE_CLASSIFIED',
          whatWeSaw: 'Card payment of INR 1799 failed with reason=issuer_timeout (source=bank).',
          whatWeConcluded: 'Temporary issuer failure (rule BANK_TIMEOUT_001, confidence 0.97).',
          whatWasAllowed: 'RETRY after an 18-minute cooldown; max 3 attempts.',
          whatWeDid: 'Recorded the classification and handed off to the policy engine.',
          whatHappened: 'Policy engine produced a RETRY decision.',
          metadata: { failureId: 'fail_1002', classificationId: 'cls_1002' },
          createdAt: at(2),
        },
        {
          id: 'aud_1002_2',
          paymentId: 'pay_1002',
          eventType: 'RECOVERY_SCHEDULED',
          whatWeSaw: 'RETRY decision for a temporary issuer failure.',
          whatWeConcluded: 'Safe to retry once the 18-minute issuer cooldown elapses.',
          whatWasAllowed: 'One retry attempt (attempt 2 of 3) after T+18m.',
          whatWeDid: 'Scheduled recovery action act_1002 for T+18m.',
          whatHappened: 'Action queued.',
          metadata: { actionId: 'act_1002' },
          createdAt: at(2),
        },
        {
          id: 'aud_1002_3',
          paymentId: 'pay_1002',
          eventType: 'RECOVERY_EXECUTED',
          whatWeSaw: 'Scheduled retry act_1002 became due at T+18m.',
          whatWeConcluded: 'All guardrails passed (attempt limit, idempotency, circuit breaker, quiet hours).',
          whatWasAllowed: 'Execute exactly one simulated payment attempt.',
          whatWeDid: 'Executed the retry against the payment simulator.',
          whatHappened: 'Payment succeeded; INR 1799 recovered (gateway latency 820ms).',
          metadata: { actionId: 'act_1002', outcomeId: 'out_1002' },
          createdAt: at(20),
        },
        {
          id: 'aud_1003_1',
          paymentId: 'pay_1003',
          eventType: 'HARD_STOP',
          whatWeSaw: 'Mandate payment of INR 8000 failed with reason=mandate_revoked (source=business).',
          whatWeConcluded: 'Mandate is no longer valid (rule MANDATE_REVOKED_001, confidence 0.99).',
          whatWasAllowed: 'No retries. Cancel every queued and scheduled recovery action.',
          whatWeDid: 'Applied the mandate kill switch and marked the payment HARD_STOPPED.',
          whatHappened: 'No further attempts will be made for this payment.',
          metadata: { failureId: 'fail_1003', actionId: 'act_1003', outcomeId: 'out_1003' },
          createdAt: at(3),
        },
        {
          id: 'aud_1004_1',
          paymentId: 'pay_1004',
          eventType: 'HUMAN_REVIEW_QUEUED',
          whatWeSaw:
            'Netbanking payment of INR 1200 failed with reason=authorization_response_mismatch (source=gateway).',
          whatWeConcluded: 'No rule matched; root cause UNKNOWN (confidence 0.30).',
          whatWasAllowed: 'No automated retry. Route to the human review queue.',
          whatWeDid: 'Created a HUMAN_REVIEW action and set recovery status to HUMAN_REVIEW.',
          whatHappened: 'Awaiting a human decision.',
          metadata: { failureId: 'fail_1004', actionId: 'act_1004' },
          createdAt: at(4),
        },
      ],
    });
  });

  const counts = {
    customers: await prismaClient.customer.count(),
    payments: await prismaClient.payment.count(),
    paymentFailures: await prismaClient.paymentFailure.count(),
    classifications: await prismaClient.classification.count(),
    recoveryActions: await prismaClient.recoveryAction.count(),
    recoveryOutcomes: await prismaClient.recoveryOutcome.count(),
    auditEvents: await prismaClient.auditEvent.count(),
  };

  console.log('[db:seed] minimal development seed applied. Table counts:');
  console.table(counts);
}

main()
  .catch((err) => {
    console.error('[db:seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prismaClient.$disconnect();
  });
