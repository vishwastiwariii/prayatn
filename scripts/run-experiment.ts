/**
 * Baseline vs Recovery Desk — the experiment, printed as a table.
 *
 *   pnpm --filter @recovery-desk/experiment exec tsx ../../scripts/run-experiment.ts [seed] [count]
 *
 * or from the repo root once tsx is available:
 *
 *   pnpm exp            (see package.json script)
 */
// Relative import: this file is a dev script, not a workspace package, so it
// cannot resolve `@recovery-desk/*` by name.
import { runExperiment } from '../packages/experiment/src/index';

const seed = Number(process.argv[2] ?? 20260828);
const count = Number(process.argv[3] ?? 500);

const r = runExperiment({ seed, count });
const rupees = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN')}`;

console.log(`\nBASELINE vs RECOVERY DESK   (seed ${r.seed}, ${r.count} payments)\n`);
console.log('Method mix     :', r.methodBreakdown);
console.log('Hidden scenarios:', r.scenarioBreakdown);

const rows: [string, string | number, string | number][] = [
  ['Payments', r.naive.eligibleFailures, r.recoveryDesk.eligibleFailures],
  ['Recovered', r.naive.recoveredCount, r.recoveryDesk.recoveredCount],
  ['Recovery rate', `${r.naive.recoveryRatePct}%`, `${r.recoveryDesk.recoveryRatePct}%`],
  [
    '₹ recovered',
    rupees(r.naive.amountRecoveredMinor),
    rupees(r.recoveryDesk.amountRecoveredMinor),
  ],
  ['Attempts', r.naive.attemptsConsumed, r.recoveryDesk.attemptsConsumed],
  ['Messages', r.naive.messagesSent, r.recoveryDesk.messagesSent],
  ['Hard stops', r.naive.hardStops, r.recoveryDesk.hardStops],
  ['Human review', r.naive.humanReviews, r.recoveryDesk.humanReviews],
  [
    'Cost / recovery',
    r.naive.costPerRecoveryMinor == null ? '—' : rupees(r.naive.costPerRecoveryMinor),
    r.recoveryDesk.costPerRecoveryMinor == null ? '—' : rupees(r.recoveryDesk.costPerRecoveryMinor),
  ],
];

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log('\n' + pad('', 18) + pad('BASELINE', 18) + 'RECOVERY DESK');
console.log('-'.repeat(54));
for (const [label, a, b] of rows) console.log(pad(label, 18) + pad(a, 18) + b);

console.log('\nImprovement:');
console.log(
  `  recovered value : ${r.comparison.recoveredValueDeltaPct > 0 ? '+' : ''}${r.comparison.recoveredValueDeltaPct}%`,
);
console.log(
  `  recovery rate   : ${r.comparison.recoveryRateDeltaPts > 0 ? '+' : ''}${r.comparison.recoveryRateDeltaPts} pts`,
);
console.log(`  attempts        : ${r.comparison.attemptsDeltaPct}%`);
console.log(`  messages        : +${r.comparison.messagesDelta}`);
console.log(
  `  cost / recovery : ${r.comparison.costPerRecoveryDeltaPct == null ? '—' : r.comparison.costPerRecoveryDeltaPct + '%'}`,
);
console.log();
