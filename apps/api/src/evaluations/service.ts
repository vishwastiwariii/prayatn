import {
  type EvaluationSummary,
  type RunEvaluationOptions,
  runEvaluation,
} from '@recovery-desk/experiment';

/**
 * Evaluation service.
 *
 * `runEvaluation` is pure, deterministic and fast (a few hundred payments × 2
 * strategies × a handful of seeds), so an evaluation is computed synchronously
 * on POST and cached by its (parameter-derived) id. Re-POSTing the same
 * parameters returns the same `evaluationId` and the cached summary.
 */

export interface EvaluationStore {
  save(summary: EvaluationSummary): void;
  get(id: string): EvaluationSummary | null;
  has(id: string): boolean;
}

export function createInMemoryEvaluationStore(): EvaluationStore {
  const map = new Map<string, EvaluationSummary>();
  return {
    save: (s) => void map.set(s.evaluationId, s),
    get: (id) => map.get(id) ?? null,
    has: (id) => map.has(id),
  };
}

export interface EvaluationDeps {
  store: EvaluationStore;
  run: (opts: RunEvaluationOptions) => EvaluationSummary;
}

export function createLiveEvaluationDeps(): EvaluationDeps {
  return { store: createInMemoryEvaluationStore(), run: runEvaluation };
}

export interface StartEvaluationResult {
  evaluationId: string;
  status: 'COMPLETED';
  /** true when this call computed it, false when an identical one already existed. */
  created: boolean;
}

export function startEvaluation(
  opts: RunEvaluationOptions,
  deps: EvaluationDeps,
): StartEvaluationResult {
  const summary = deps.run(opts);
  const created = !deps.store.has(summary.evaluationId);
  if (created) deps.store.save(summary);
  return { evaluationId: summary.evaluationId, status: 'COMPLETED', created };
}

export function getEvaluation(id: string, deps: EvaluationDeps): EvaluationSummary | null {
  return deps.store.get(id);
}
