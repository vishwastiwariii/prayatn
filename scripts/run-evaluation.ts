/**
 * Recovery Desk vs naive — the full evaluation, printed.
 *
 *   pnpm eval                       seed 20260904, 500 payments
 *   pnpm eval 500 20260904 20260905 20260906   count then one or more seeds
 *
 * Numbers are produced by the deterministic hidden-state simulator; nothing is
 * hardcoded.
 */
// Relative import: this file is a dev script, not a workspace package.
import { runEvaluation } from '../packages/experiment/src/index';

const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
const count = args[0] ?? 500;
const seeds = args.length > 1 ? args.slice(1) : [20260904];

const summary = runEvaluation({ seeds, count });
console.log('\n' + summary.renderedSummary + '\n');
console.log(`evaluationId: ${summary.evaluationId}   status: ${summary.status}`);
