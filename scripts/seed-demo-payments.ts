/**
 * Seeds a handful of realistic customers + payments directly (data setup
 * only), then drives each one through the REAL HTTP pipeline — ingest ->
 * classify -> decide -> enqueue(immediate) — so the Phase 11 dashboard has
 * more than the Phase 3 hand-written seed to show.
 *
 * This intentionally does not touch business logic: every classification and
 * recovery decision comes from the running API, exactly as a real failure
 * would produce it. Requires the API (`pnpm --filter @recovery-desk/api dev`)
 * and the recovery worker (`pnpm --filter @recovery-desk/recovery-worker dev`)
 * to be running so RETRY/WAIT/MESSAGE/SWITCH_RAIL actions actually execute.
 *
 *   pnpm tsx scripts/seed-demo-payments.ts
 */
// Relative import: this file is a dev script, not a workspace package, so it
// cannot resolve `@recovery-desk/*` by name (see scripts/run-experiment.ts).
import { prismaClient } from '../packages/db/src/index';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface DemoPayment {
  id: string;
  customerId: string;
  amount: string;
  method: 'CARD' | 'UPI' | 'NETBANKING' | 'WALLET' | 'MANDATE';
  error: {
    code: string;
    reason: string;
    source: 'CUSTOMER' | 'BANK' | 'GATEWAY' | 'BUSINESS';
    step: 'AUTHENTICATION' | 'AUTHORIZATION' | 'CAPTURE';
    description: string;
  };
}

const CUSTOMERS = [
  { id: 'cust_demo_priya', name: 'Priya Sharma', email: 'priya.sharma@example.in', balanceState: 'LOW', salaryDay: 5, preferredLanguage: 'HINGLISH' },
  { id: 'cust_demo_arjun', name: 'Arjun Iyer', email: 'arjun.iyer@example.in', balanceState: 'HEALTHY', salaryDay: 1, preferredLanguage: 'EN' },
  { id: 'cust_demo_fatima', name: 'Fatima Sheikh', email: 'fatima.sheikh@example.in', balanceState: 'CRITICAL', salaryDay: 28, preferredLanguage: 'HI' },
  { id: 'cust_demo_karan', name: 'Karan Malhotra', email: 'karan.malhotra@example.in', balanceState: 'HEALTHY', salaryDay: 10, preferredLanguage: 'EN' },
  { id: 'cust_demo_divya', name: 'Divya Reddy', email: 'divya.reddy@example.in', balanceState: 'LOW', salaryDay: 15, preferredLanguage: 'HINGLISH' },
] as const;

const PAYMENTS: DemoPayment[] = [
  {
    id: 'pay_demo_01', customerId: 'cust_demo_priya', amount: '1899.00', method: 'CARD',
    error: { code: 'BAD_REQUEST_ERROR', reason: 'issuer_timeout', source: 'BANK', step: 'AUTHORIZATION', description: 'Issuer did not respond within the authorization window' },
  },
  {
    id: 'pay_demo_02', customerId: 'cust_demo_arjun', amount: '4500.00', method: 'UPI',
    error: { code: 'BAD_REQUEST_ERROR', reason: 'issuer_timeout', source: 'BANK', step: 'AUTHORIZATION', description: 'Bank timed out processing the authorization' },
  },
  {
    id: 'pay_demo_03', customerId: 'cust_demo_fatima', amount: '999.00', method: 'CARD',
    error: { code: 'BAD_REQUEST_ERROR', reason: 'insufficient_funds', source: 'BANK', step: 'AUTHORIZATION', description: 'Insufficient balance in account' },
  },
  {
    id: 'pay_demo_04', customerId: 'cust_demo_divya', amount: '2200.00', method: 'UPI',
    error: { code: 'BAD_REQUEST_ERROR', reason: 'insufficient_funds', source: 'BANK', step: 'AUTHORIZATION', description: 'Not enough balance to complete the transaction' },
  },
  {
    id: 'pay_demo_05', customerId: 'cust_demo_karan', amount: '3200.00', method: 'CARD',
    error: { code: 'GATEWAY_ERROR', reason: 'expired_card', source: 'CUSTOMER', step: 'AUTHORIZATION', description: 'Card has expired' },
  },
  {
    id: 'pay_demo_06', customerId: 'cust_demo_priya', amount: '750.00', method: 'MANDATE',
    error: { code: 'BUSINESS_ERROR', reason: 'mandate_revoked', source: 'BUSINESS', step: 'AUTHORIZATION', description: 'Mandate has been revoked by the customer' },
  },
  {
    id: 'pay_demo_07', customerId: 'cust_demo_arjun', amount: '1500.00', method: 'CARD',
    error: { code: 'GATEWAY_ERROR', reason: 'authentication_failed', source: 'CUSTOMER', step: 'AUTHENTICATION', description: '3-D Secure authentication failed, incorrect OTP' },
  },
  {
    id: 'pay_demo_08', customerId: 'cust_demo_fatima', amount: '899.00', method: 'CARD',
    error: { code: 'GATEWAY_ERROR', reason: '3ds_abandoned', source: 'CUSTOMER', step: 'AUTHENTICATION', description: 'Customer did not complete 3-D Secure authentication' },
  },
  {
    id: 'pay_demo_09', customerId: 'cust_demo_divya', amount: '2750.00', method: 'UPI',
    error: { code: 'GATEWAY_ERROR', reason: 'upi_collect_timeout', source: 'CUSTOMER', step: 'AUTHENTICATION', description: 'UPI collect request expired waiting for approval' },
  },
  {
    id: 'pay_demo_10', customerId: 'cust_demo_karan', amount: '5200.00', method: 'NETBANKING',
    error: { code: 'GATEWAY_ERROR', reason: 'gateway_timeout', source: 'GATEWAY', step: 'AUTHORIZATION', description: 'Gateway timeout — upstream did not respond' },
  },
  {
    id: 'pay_demo_11', customerId: 'cust_demo_priya', amount: '640.00', method: 'WALLET',
    error: { code: 'GATEWAY_ERROR', reason: 'gateway_5xx', source: 'GATEWAY', step: 'CAPTURE', description: 'Gateway returned a 502 bad gateway error' },
  },
  {
    id: 'pay_demo_12', customerId: 'cust_demo_arjun', amount: '8400.00', method: 'CARD',
    error: { code: 'UNKNOWN_ERROR', reason: 'processor_rejected', source: 'GATEWAY', step: 'AUTHORIZATION', description: 'Transaction declined by upstream processor for undocumented reasons' },
  },
];

async function ensureCustomers(): Promise<void> {
  for (const c of CUSTOMERS) {
    await prismaClient.customer.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        name: c.name,
        email: c.email,
        balanceState: c.balanceState,
        salaryDay: c.salaryDay,
        preferredLanguage: c.preferredLanguage,
      },
    });
  }
}

async function ensurePayments(): Promise<void> {
  for (const p of PAYMENTS) {
    await prismaClient.payment.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        customerId: p.customerId,
        amount: p.amount,
        currency: 'INR',
        method: p.method,
        status: 'PENDING',
      },
    });
  }
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function driveOne(p: DemoPayment): Promise<void> {
  const ingest = await postJson(
    '/api/payments/failures',
    { paymentId: p.id, amount: Number(p.amount), method: p.method, error: p.error },
    { 'Idempotency-Key': `demo-seed-${p.id}` },
  );
  const failureId = (ingest.json as { failureId?: string } | null)?.failureId;
  if (!failureId) {
    console.error(`  ingest failed for ${p.id}:`, ingest.status, ingest.json);
    return;
  }

  const classify = await postJson(`/api/payments/failures/${failureId}/classify`, {});
  const cause = (classify.json as { cause?: string } | null)?.cause;

  const decide = await postJson(`/api/payments/failures/${failureId}/decide`, {});
  const decision = decide.json as { action?: { actionId?: string; action?: string } } | null;
  const actionId = decision?.action?.actionId;
  const action = decision?.action?.action;

  let enqueued = 'n/a';
  if (actionId && ['RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE'].includes(action ?? '')) {
    const enqueue = await postJson(`/api/recovery-actions/${actionId}/enqueue`, { immediate: true });
    enqueued = String(enqueue.status);
  }

  console.log(`  ${p.id}: cause=${cause} action=${action} enqueue=${enqueued}`);
}

async function main() {
  console.log('Seeding demo customers + payments...');
  await ensureCustomers();
  await ensurePayments();

  console.log('Driving each payment through the real ingest -> classify -> decide -> enqueue pipeline...');
  for (const p of PAYMENTS) {
    await driveOne(p);
  }

  console.log('Waiting 3s for the recovery worker to process immediate jobs...');
  await new Promise((r) => setTimeout(r, 3000));

  console.log('Done.');
  await prismaClient.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prismaClient.$disconnect();
  process.exit(1);
});
