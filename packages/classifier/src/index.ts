/**
 * `@recovery-desk/classifier` — a pure, deterministic root-cause classifier.
 *
 *   classify(ClassifierInput) -> { cause, confidence, ruleId, explanation, evidence, candidates }
 *
 * It DIAGNOSES a persisted payment failure. It does not decide what to do about
 * it (no retry / wait / hard-stop) — that is the policy engine's job.
 */
export const CLASSIFIER_PACKAGE = '@recovery-desk/classifier' as const;

export { classify, UNKNOWN_CONFIDENCE, UNKNOWN_RULE_ID } from './classify';
export { RULES } from './rules';
export { normalizeInput, canonical } from './normalize';
export { CLASSIFIER_VERSION } from './version';
export type {
  ClassifierInput,
  ClassificationResult,
  ClassificationCandidate,
  Rule,
  RuleEvaluation,
  RuleMatch,
  MatchStrength,
  NormalizedInput,
} from './types';
