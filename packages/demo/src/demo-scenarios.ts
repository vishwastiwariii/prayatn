import type { FailureSource, FailureStep, PaymentMethod, RootCause } from '@recovery-desk/domain';

/**
 * Phase 13 §5 — the curated presentation dataset.
 *
 * ~12 payments, not 500: the live demo has to be readable on a projector. The
 * full 500-payment experiment still runs in the evaluation section, and the
 * numbers on the final screen come from THAT, not from these twelve.
 *
 * Every id is prefixed `demo_` — that prefix IS the isolation boundary
 * (Phase 13 §28). `POST /api/demo/reset` deletes exactly these rows and
 * nothing else, so a demo run can never damage development data.
 */

export const DEMO_ID_PREFIX = 'demo_';

export interface DemoCustomer {
  id: string;
  name: string;
  email: string;
  balanceState: 'HEALTHY' | 'LOW' | 'CRITICAL' | 'UNKNOWN';
  salaryDay: number;
  preferredLanguage: 'EN' | 'HI' | 'HINGLISH';
}

export interface DemoPayment {
  id: string;
  customerId: string;
  /** Decimal string, matching the NUMERIC(14,2) column. */
  amount: string;
  amountMinor: number;
  method: PaymentMethod;
  error: {
    code: string;
    reason: string;
    source: FailureSource;
    step: FailureStep;
    description: string;
  };
  /**
   * What the DETERMINISTIC classifier is expected to conclude. Used by the
   * smoke test to prove the demo dataset still exercises every playbook —
   * never used to shortcut or fake the real classification.
   */
  expectedCause: RootCause;
  /** One-line presenter note shown under the payment in the demo UI. */
  note: string;
}

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    id: 'demo_cust_asha',
    name: 'Asha Menon',
    email: 'demo.asha@recoverydesk.test',
    balanceState: 'LOW',
    salaryDay: 1,
    preferredLanguage: 'HINGLISH',
  },
  {
    id: 'demo_cust_rohan',
    name: 'Rohan Gupta',
    email: 'demo.rohan@recoverydesk.test',
    balanceState: 'HEALTHY',
    salaryDay: 7,
    preferredLanguage: 'EN',
  },
  {
    id: 'demo_cust_meera',
    name: 'Meera Nair',
    email: 'demo.meera@recoverydesk.test',
    balanceState: 'CRITICAL',
    salaryDay: 1,
    preferredLanguage: 'HI',
  },
  {
    id: 'demo_cust_vikram',
    name: 'Vikram Shah',
    email: 'demo.vikram@recoverydesk.test',
    balanceState: 'HEALTHY',
    salaryDay: 15,
    preferredLanguage: 'EN',
  },
  {
    id: 'demo_cust_neha',
    name: 'Neha Kulkarni',
    email: 'demo.neha@recoverydesk.test',
    balanceState: 'LOW',
    salaryDay: 5,
    preferredLanguage: 'HINGLISH',
  },
] as const;

export const DEMO_PAYMENTS: readonly DemoPayment[] = [
  // --- the hero payment: temporary issuer failure, recovers on retry --------
  {
    id: 'demo_pay_1001',
    customerId: 'demo_cust_asha',
    amount: '2500.00',
    amountMinor: 250000,
    method: 'UPI',
    error: {
      code: 'BANK_TIMEOUT',
      reason: 'issuer_timeout',
      source: 'BANK',
      step: 'AUTHORIZATION',
      description: 'Bank did not respond within the authorization window.',
    },
    expectedCause: 'ISSUER_TEMPORARY_FAILURE',
    note: 'The bank was briefly unreachable — worth retrying, but not right now.',
  },
  {
    id: 'demo_pay_1002',
    customerId: 'demo_cust_meera',
    amount: '4200.00',
    amountMinor: 420000,
    method: 'CARD',
    error: {
      code: 'BAD_REQUEST_ERROR',
      reason: 'insufficient_funds',
      source: 'BANK',
      step: 'AUTHORIZATION',
      description: 'Insufficient funds in the account.',
    },
    expectedCause: 'CUSTOMER_FUNDS_LOW',
    note: 'Retrying in 30 seconds cannot create money. Wait for the salary window.',
  },
  {
    id: 'demo_pay_1003',
    customerId: 'demo_cust_rohan',
    amount: '1899.00',
    amountMinor: 189900,
    method: 'CARD',
    error: {
      code: 'BANK_TIMEOUT',
      reason: 'issuer_timeout',
      source: 'BANK',
      step: 'AUTHORIZATION',
      description: 'Issuer did not respond within the authorization window.',
    },
    expectedCause: 'ISSUER_TEMPORARY_FAILURE',
    note: 'Second issuer timeout — same diagnosis, same bounded retry.',
  },
  {
    id: 'demo_pay_1004',
    customerId: 'demo_cust_vikram',
    amount: '3100.00',
    amountMinor: 310000,
    method: 'UPI',
    error: {
      code: 'BANK_TIMEOUT',
      reason: 'issuer_timeout',
      source: 'BANK',
      step: 'AUTHORIZATION',
      description: 'Bank timed out processing the authorization.',
    },
    expectedCause: 'ISSUER_TEMPORARY_FAILURE',
    note: 'Third issuer timeout — these are the ones that actually recover.',
  },
  // --- gateway-side failures: the ones the storm will catch -----------------
  {
    id: 'demo_pay_1005',
    customerId: 'demo_cust_neha',
    amount: '5200.00',
    amountMinor: 520000,
    method: 'NETBANKING',
    error: {
      code: 'GATEWAY_ERROR',
      reason: 'gateway_timeout',
      source: 'GATEWAY',
      step: 'AUTHORIZATION',
      description: 'Gateway timeout — upstream did not respond.',
    },
    expectedCause: 'GATEWAY_FAILURE',
    note: 'The gateway itself failed before the bank ever saw this payment.',
  },
  {
    id: 'demo_pay_1006',
    customerId: 'demo_cust_rohan',
    amount: '2750.00',
    amountMinor: 275000,
    method: 'WALLET',
    error: {
      code: 'GATEWAY_ERROR',
      reason: 'gateway_5xx',
      source: 'GATEWAY',
      step: 'CAPTURE',
      description: 'Gateway returned a 502 bad gateway error.',
    },
    expectedCause: 'GATEWAY_FAILURE',
    note: 'Second gateway 5xx — a pattern, not an accident.',
  },
  // --- customer-side failures: a message, not a retry ----------------------
  {
    id: 'demo_pay_1007',
    customerId: 'demo_cust_vikram',
    amount: '1500.00',
    amountMinor: 150000,
    method: 'CARD',
    error: {
      code: 'GATEWAY_ERROR',
      reason: 'authentication_failed',
      source: 'CUSTOMER',
      step: 'AUTHENTICATION',
      description: '3-D Secure authentication failed, incorrect OTP.',
    },
    expectedCause: 'CUSTOMER_AUTH_FAILURE',
    note: 'The customer got the OTP wrong. A silent retry fails the same way.',
  },
  {
    id: 'demo_pay_1008',
    customerId: 'demo_cust_asha',
    amount: '900.00',
    amountMinor: 90000,
    method: 'CARD',
    error: {
      code: 'GATEWAY_ERROR',
      reason: '3ds_abandoned',
      source: 'CUSTOMER',
      step: 'AUTHENTICATION',
      description: 'Customer did not complete 3-D Secure authentication.',
    },
    expectedCause: 'CUSTOMER_ABANDONMENT',
    note: 'They walked away mid-checkout. Nudge them; do not charge blindly.',
  },
  // --- structurally terminal: stopping is the correct answer ---------------
  {
    id: 'demo_pay_1009',
    customerId: 'demo_cust_neha',
    amount: '3200.00',
    amountMinor: 320000,
    method: 'CARD',
    error: {
      code: 'GATEWAY_ERROR',
      reason: 'expired_card',
      source: 'CUSTOMER',
      step: 'AUTHORIZATION',
      description: 'Card has expired.',
    },
    expectedCause: 'PAYMENT_METHOD_INVALID',
    note: 'No number of retries un-expires a card. Hard stop.',
  },
  {
    id: 'demo_pay_1010',
    customerId: 'demo_cust_meera',
    amount: '8000.00',
    amountMinor: 800000,
    method: 'MANDATE',
    error: {
      code: 'BUSINESS_ERROR',
      reason: 'mandate_revoked',
      source: 'BUSINESS',
      step: 'AUTHORIZATION',
      description: 'Mandate has been revoked by the customer.',
    },
    expectedCause: 'MANDATE_INVALID',
    note: 'The customer withdrew permission. Retrying here is the expensive kind of wrong.',
  },
  // --- the unknown: the one the AI is allowed to have an opinion about -----
  {
    id: 'demo_pay_1011',
    customerId: 'demo_cust_rohan',
    amount: '4300.00',
    amountMinor: 430000,
    method: 'CARD',
    error: {
      code: 'RESP_77',
      reason: 'response_code_77',
      source: 'GATEWAY',
      step: 'AUTHORIZATION',
      description: 'Acquirer switch returned response code 77; reconciliation mismatch flagged.',
    },
    expectedCause: 'UNKNOWN',
    note: 'Our rules have never seen this. It goes to a human, not to a retry.',
  },
  {
    id: 'demo_pay_1012',
    customerId: 'demo_cust_asha',
    amount: '851.00',
    amountMinor: 85100,
    method: 'UPI',
    error: {
      code: 'BAD_REQUEST_ERROR',
      reason: 'insufficient_funds',
      source: 'BANK',
      step: 'AUTHORIZATION',
      description: 'Not enough balance to complete the transaction.',
    },
    expectedCause: 'CUSTOMER_FUNDS_LOW',
    note: 'Second funds-low case — waits for the same salary window.',
  },
] as const;

/** Total amount at risk across the demo batch, in minor units. */
export const DEMO_AMOUNT_AT_RISK_MINOR = DEMO_PAYMENTS.reduce((sum, p) => sum + p.amountMinor, 0);

/** The payment the AI-message stage uses (abandonment + a Hinglish customer). */
export const DEMO_AI_MESSAGE_PAYMENT_ID = 'demo_pay_1008';
/** The payment the human-review stage uses (the unclassifiable one). */
export const DEMO_UNKNOWN_PAYMENT_ID = 'demo_pay_1011';
/** The payment the presenter traces end to end (issuer timeout -> storm -> recovered). */
export const DEMO_TRACE_PAYMENT_ID = 'demo_pay_1001';

/** Expected cause distribution — asserted by the demo package's tests. */
export function demoCauseDistribution(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of DEMO_PAYMENTS) {
    counts[p.expectedCause] = (counts[p.expectedCause] ?? 0) + 1;
  }
  return counts;
}
