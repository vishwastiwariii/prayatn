import { SIM_EPOCH } from './clock';
import { type Rng, createRng } from './rng';
import { type ScenarioKind, type SimulationTruth, buildTruth } from './scenarios';

export type PaymentMethod = 'CARD' | 'UPI' | 'NETBANKING' | 'WALLET' | 'MANDATE';

/** The public record for one payment in the frozen batch. */
export interface SimulatedPayment {
  id: string;
  customerId: string;
  method: PaymentMethod;
  amountMinor: number;
  currency: 'INR';
  /** Day of month (1-28) the customer is paid — visible; drives funds-low policy. */
  salaryDay: number;
  /** Epoch-ms the original charge was attempted (and failed). */
  originatedAtMs: number;
}

export interface SimulatedDataset {
  seed: number;
  payments: SimulatedPayment[];
  /** paymentId -> hidden truth. The experiment runner keeps this private. */
  truth: Map<string, SimulationTruth>;
  methodBreakdown: Record<PaymentMethod, number>;
  scenarioBreakdown: Record<ScenarioKind, number>;
}

// Realistic Indian PSP method mix (CLAUDE.md Phase 5).
const METHODS: PaymentMethod[] = ['CARD', 'UPI', 'NETBANKING', 'MANDATE', 'WALLET'];
const METHOD_WEIGHTS = [45, 30, 10, 10, 5];

// Amount ranges (minor units = paise) by method.
const AMOUNT_RANGE: Record<PaymentMethod, [number, number]> = {
  CARD: [30_000, 800_000],
  UPI: [5_000, 250_000],
  NETBANKING: [100_000, 2_500_000],
  MANDATE: [49_900, 499_900],
  WALLET: [2_000, 120_000],
};

// Scenario mix per method. Weights need not sum to 100.
const SCENARIO_WEIGHTS: Record<PaymentMethod, Partial<Record<ScenarioKind, number>>> = {
  CARD: {
    ISSUER_TEMPORARY: 26,
    GATEWAY_5XX: 12,
    FUNDS_LOW: 18,
    AUTH_FAILURE: 16,
    ABANDONMENT: 12,
    INVALID_METHOD: 10,
    UNKNOWN: 6,
  },
  UPI: {
    ISSUER_TEMPORARY: 14,
    GATEWAY_5XX: 16,
    FUNDS_LOW: 20,
    ABANDONMENT: 34,
    AUTH_FAILURE: 8,
    UNKNOWN: 8,
  },
  NETBANKING: {
    ISSUER_TEMPORARY: 30,
    GATEWAY_5XX: 24,
    FUNDS_LOW: 20,
    AUTH_FAILURE: 12,
    UNKNOWN: 14,
  },
  MANDATE: {
    MANDATE_REVOKED: 46,
    FUNDS_LOW: 30,
    ISSUER_TEMPORARY: 14,
    GATEWAY_5XX: 6,
    UNKNOWN: 4,
  },
  WALLET: {
    FUNDS_LOW: 40,
    GATEWAY_5XX: 22,
    ISSUER_TEMPORARY: 16,
    ABANDONMENT: 14,
    UNKNOWN: 8,
  },
};

function pickScenario(method: PaymentMethod, rng: Rng): ScenarioKind {
  const entries = Object.entries(SCENARIO_WEIGHTS[method]) as [ScenarioKind, number][];
  return rng.weighted(
    entries.map(([k]) => k),
    entries.map(([, w]) => w),
  );
}

const DATASET_SPAN_DAYS = 35; // origination spread, so salary-day maths varies

export function generateDataset(seed = 20260828, count = 500): SimulatedDataset {
  const rng = createRng(seed);
  const payments: SimulatedPayment[] = [];
  const truth = new Map<string, SimulationTruth>();
  const methodBreakdown = { CARD: 0, UPI: 0, NETBANKING: 0, MANDATE: 0, WALLET: 0 } as Record<
    PaymentMethod,
    number
  >;
  const scenarioBreakdown = {
    ISSUER_TEMPORARY: 0,
    GATEWAY_5XX: 0,
    FUNDS_LOW: 0,
    AUTH_FAILURE: 0,
    ABANDONMENT: 0,
    INVALID_METHOD: 0,
    MANDATE_REVOKED: 0,
    UNKNOWN: 0,
  } as Record<ScenarioKind, number>;

  for (let i = 0; i < count; i += 1) {
    const id = `sim_pay_${String(i).padStart(4, '0')}`;
    const method = rng.weighted(METHODS, METHOD_WEIGHTS);
    const [lo, hi] = AMOUNT_RANGE[method];
    const amountMinor = rng.int(lo / 100, hi / 100) * 100;
    const salaryDay = rng.int(1, 28);
    const originatedAtMs =
      SIM_EPOCH.getTime() + Math.round(rng.float(0, DATASET_SPAN_DAYS * 24 * 60)) * 60_000;

    const kind = pickScenario(method, rng);
    const pTruth = buildTruth(kind, method, originatedAtMs, salaryDay, rng.fork(id));

    payments.push({
      id,
      customerId: `sim_cust_${String(i % 220).padStart(4, '0')}`,
      method,
      amountMinor,
      currency: 'INR',
      salaryDay,
      originatedAtMs,
    });
    truth.set(id, pTruth);
    methodBreakdown[method] += 1;
    scenarioBreakdown[kind] += 1;
  }

  return { seed, payments, truth, methodBreakdown, scenarioBreakdown };
}
