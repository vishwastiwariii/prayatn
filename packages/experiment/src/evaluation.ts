import { type RootCauseRow, rootCauseBreakdown } from './breakdown';
import { COST_PER_ATTEMPT_MINOR, COST_PER_MESSAGE_MINOR } from './metrics';
import { runExperimentDetailed } from './runner';
import type { ExperimentComparison, StrategyMetrics } from './types';

/**
 * The comparison engine — Phase 9.
 *
 *   500 seeded failures
 *        ├── NAIVE RETRY (3 immediate)          same payments, same initial
 *        └── RECOVERY DESK (classify→policy→…)  failures, same hidden state,
 *              │                                same clock, same seed
 *              ▼
 *        RESULTS ──▶ COMPARISON ──▶ EvaluationSummary
 *
 * A single seed answers "does Recovery Desk recover more money with fewer
 * attempts". Multiple seeds answer "is that true in general, not just on a
 * lucky seed".
 */

export const DEFAULT_EVALUATION_SEED = 20260904;
const MAX_SEEDS = 25;
const MIN_COUNT = 10;
const MAX_COUNT = 5000;

export interface RunEvaluationOptions {
  /** One or more seeds. Defaults to `[DEFAULT_EVALUATION_SEED]`. */
  seeds?: number[];
  /** Convenience single-seed alias (ignored if `seeds` is given). */
  seed?: number;
  /** Payments per seed. Default 500. */
  count?: number;
}

export interface SeedResult {
  seed: number;
  naive: StrategyMetrics;
  recoveryDesk: StrategyMetrics;
  comparison: ExperimentComparison;
}

export interface Spread {
  mean: number;
  min: number;
  max: number;
}

export interface EvaluationAggregate {
  seedCount: number;
  naiveRecoveryRatePct: Spread;
  recoveryDeskRecoveryRatePct: Spread;
  recoveryRateDeltaPts: Spread;
  recoveredValueDeltaPct: Spread;
  attemptsDeltaPct: Spread;
  /** RD recovered at least as many payments AND a higher rate on EVERY seed. */
  recoveryDeskWinsEverySeed: boolean;
}

export interface EvaluationSummary {
  evaluationId: string;
  status: 'COMPLETED';
  datasetSize: number;
  seeds: number[];
  primarySeed: number;
  costModel: { perAttemptMinor: number; perMessageMinor: number };
  /** The headline table = the primary seed's run (matches the required output block). */
  headline: {
    naive: StrategyMetrics;
    recoveryDesk: StrategyMetrics;
    comparison: ExperimentComparison;
  };
  rootCauseBreakdown: RootCauseRow[];
  perSeed: SeedResult[];
  aggregate: EvaluationAggregate;
  renderedSummary: string;
}

function normalizeOptions(opts: RunEvaluationOptions): { seeds: number[]; count: number } {
  let seeds = opts.seeds ?? (opts.seed != null ? [opts.seed] : [DEFAULT_EVALUATION_SEED]);
  seeds = [...new Set(seeds.map((s) => Math.trunc(s)))];
  if (seeds.length === 0) seeds = [DEFAULT_EVALUATION_SEED];
  if (seeds.length > MAX_SEEDS) throw new RangeError(`at most ${MAX_SEEDS} seeds`);
  if (seeds.some((s) => !Number.isFinite(s))) throw new TypeError('seeds must be integers');

  const count = Math.trunc(opts.count ?? 500);
  if (count < MIN_COUNT || count > MAX_COUNT) {
    throw new RangeError(`count must be between ${MIN_COUNT} and ${MAX_COUNT}`);
  }
  return { seeds, count };
}

/**
 * `eval_` + a short stable hash of the parameters — same params => same id.
 * Seed ORDER is part of the identity (the first seed is the headline seed).
 */
export function evaluationIdFor(seeds: number[], count: number): string {
  const key = `${seeds.join(',')}:${count}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `eval_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function spread(values: number[]): Spread {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean: Math.round(mean * 100) / 100,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function runEvaluation(opts: RunEvaluationOptions = {}): EvaluationSummary {
  const { seeds, count } = normalizeOptions(opts);
  const primarySeed = seeds[0] as number;

  const primary = runExperimentDetailed({ seed: primarySeed, count });

  const perSeed: SeedResult[] = seeds.map((seed) => {
    const { result } = seed === primarySeed ? primary : runExperimentDetailed({ seed, count });
    return {
      seed,
      naive: result.naive,
      recoveryDesk: result.recoveryDesk,
      comparison: result.comparison,
    };
  });

  const aggregate: EvaluationAggregate = {
    seedCount: seeds.length,
    naiveRecoveryRatePct: spread(perSeed.map((s) => s.naive.recoveryRatePct)),
    recoveryDeskRecoveryRatePct: spread(perSeed.map((s) => s.recoveryDesk.recoveryRatePct)),
    recoveryRateDeltaPts: spread(perSeed.map((s) => s.comparison.recoveryRateDeltaPts)),
    recoveredValueDeltaPct: spread(perSeed.map((s) => s.comparison.recoveredValueDeltaPct)),
    attemptsDeltaPct: spread(perSeed.map((s) => s.comparison.attemptsDeltaPct)),
    recoveryDeskWinsEverySeed: perSeed.every(
      (s) =>
        s.recoveryDesk.recoveredCount >= s.naive.recoveredCount &&
        s.comparison.recoveryRateDeltaPts > 0,
    ),
  };

  const breakdown = rootCauseBreakdown(
    primary.dataset,
    primary.naiveRuns,
    primary.recoveryDeskRuns,
  );

  const summary: Omit<EvaluationSummary, 'renderedSummary'> = {
    evaluationId: evaluationIdFor(seeds, count),
    status: 'COMPLETED',
    datasetSize: count,
    seeds,
    primarySeed,
    costModel: { perAttemptMinor: COST_PER_ATTEMPT_MINOR, perMessageMinor: COST_PER_MESSAGE_MINOR },
    headline: {
      naive: primary.result.naive,
      recoveryDesk: primary.result.recoveryDesk,
      comparison: primary.result.comparison,
    },
    rootCauseBreakdown: breakdown,
    perSeed,
    aggregate,
  };

  return { ...summary, renderedSummary: renderSummary(summary) };
}

// --- text rendering --------------------------------------------------

function rupees(minor: number): string {
  return `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
}
function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

export function renderSummary(s: Omit<EvaluationSummary, 'renderedSummary'>): string {
  const n = s.headline.naive;
  const d = s.headline.recoveryDesk;
  const line = '─'.repeat(44);

  const rows: [string, string | number, string | number][] = [
    ['Recovered', n.recoveredCount, d.recoveredCount],
    ['Recovery Rate', `${n.recoveryRatePct}%`, `${d.recoveryRatePct}%`],
    ['₹ Recovered', rupees(n.amountRecoveredMinor), rupees(d.amountRecoveredMinor)],
    ['Attempts', n.attemptsConsumed, d.attemptsConsumed],
    ['Messages', n.messagesSent, d.messagesSent],
    [
      'Cost / Recovery',
      n.costPerRecoveryMinor == null ? '—' : rupees(n.costPerRecoveryMinor),
      d.costPerRecoveryMinor == null ? '—' : rupees(d.costPerRecoveryMinor),
    ],
    ['Hard Stops', n.hardStops, d.hardStops],
    ['Human Review', n.humanReviews, d.humanReviews],
  ];

  const out: string[] = [];
  out.push('RECOVERY DESK — EXPERIMENT RESULTS', '');
  out.push('Dataset', `${s.datasetSize} failed payments`, '');
  out.push(
    'Seed',
    s.seeds.length === 1 ? `${s.primarySeed}` : `${s.primarySeed} (+${s.seeds.length - 1} more)`,
    '',
  );
  out.push(line, '');
  out.push(pad('', 20) + pad('Naive', 14) + 'Recovery Desk', '');
  for (const [label, a, b] of rows) out.push(pad(label, 20) + pad(a, 14) + b);
  out.push('', line, 'BY ROOT CAUSE', '');
  out.push(
    pad('Root Cause', 26) +
      pad('Init', 6) +
      pad('N.rec', 7) +
      pad('RD.rec', 7) +
      pad('N.att', 7) +
      pad('RD.att', 7) +
      pad('₹ N', 12) +
      '₹ RD',
  );
  for (const r of s.rootCauseBreakdown) {
    out.push(
      pad(r.cause, 26) +
        pad(r.initialFailures, 6) +
        pad(r.naiveRecoveries, 7) +
        pad(r.recoveryDeskRecoveries, 7) +
        pad(r.naiveAttempts, 7) +
        pad(r.recoveryDeskAttempts, 7) +
        pad(rupees(r.naiveAmountRecoveredMinor), 12) +
        rupees(r.recoveryDeskAmountRecoveredMinor),
    );
  }

  if (s.seeds.length > 1) {
    const a = s.aggregate;
    out.push('', line, `ACROSS ${a.seedCount} SEEDS`, '');
    out.push(
      `Recovery rate — Naive   mean ${a.naiveRecoveryRatePct.mean}%  (min ${a.naiveRecoveryRatePct.min}%, max ${a.naiveRecoveryRatePct.max}%)`,
    );
    out.push(
      `Recovery rate — RD      mean ${a.recoveryDeskRecoveryRatePct.mean}%  (min ${a.recoveryDeskRecoveryRatePct.min}%, max ${a.recoveryDeskRecoveryRatePct.max}%)`,
    );
    out.push(
      `Rate delta (pts)        mean +${a.recoveryRateDeltaPts.mean}  (min +${a.recoveryRateDeltaPts.min}, max +${a.recoveryRateDeltaPts.max})`,
    );
    out.push(
      `Recovered value delta   mean +${a.recoveredValueDeltaPct.mean}%  (min +${a.recoveredValueDeltaPct.min}%, max +${a.recoveredValueDeltaPct.max}%)`,
    );
    out.push(
      `Attempts delta          mean ${a.attemptsDeltaPct.mean}%  (min ${a.attemptsDeltaPct.min}%, max ${a.attemptsDeltaPct.max}%)`,
    );
    out.push(`Recovery Desk wins on every seed: ${a.recoveryDeskWinsEverySeed ? 'yes' : 'NO'}`);
  }

  return out.join('\n');
}
