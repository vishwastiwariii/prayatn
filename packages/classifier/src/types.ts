import type { FailureSource, FailureStep, PaymentMethod, RootCause } from '@recovery-desk/domain';

/**
 * The classifier's view of a persisted `payment_failure` (+ its payment).
 * Deliberately a plain data shape with no Prisma / DB coupling so the package
 * stays pure and trivially testable.
 */
export interface ClassifierInput {
  errorCode: string;
  errorReason: string;
  errorSource: FailureSource;
  errorStep: FailureStep;
  errorDescription: string;
  /** Payment rail the failed charge used. A few rules are rail-aware. */
  method: PaymentMethod;
}

/** How strongly a rule matched — feeds the deterministic confidence. */
export type MatchStrength = 'EXACT_REASON' | 'ERROR_CODE' | 'COMPOSITE' | 'DESCRIPTION';

export interface RuleMatch {
  matched: true;
  /** 0..1, fixed per (rule, strength). Never random, never time-based. */
  confidence: number;
  strength: MatchStrength;
  /** Machine-readable signals that fired, e.g. `reason=insufficient_funds`. */
  evidence: string[];
}

export type RuleEvaluation = RuleMatch | { matched: false };

export interface Rule {
  /** Stable id persisted on the classification row, e.g. `FUNDS_LOW_001`. */
  id: string;
  cause: RootCause;
  /**
   * Explicit precedence. LOWER wins. Every rule has a unique priority so the
   * winning rule never depends on array order or accidental if/else nesting.
   */
  priority: number;
  /** What this rule diagnoses (not what to do about it). */
  description: string;
  evaluate(input: NormalizedInput): RuleEvaluation;
}

/** Pre-lowercased / tokenised view built once per classification. */
export interface NormalizedInput {
  raw: ClassifierInput;
  reason: string;
  code: string;
  description: string;
  source: FailureSource;
  step: FailureStep;
  method: PaymentMethod;
  /** `reason` split on non-alphanumerics, for whole-token checks. */
  reasonTokens: Set<string>;
}

export interface ClassificationCandidate {
  ruleId: string;
  cause: RootCause;
  priority: number;
  confidence: number;
  strength: MatchStrength;
  evidence: string[];
}

export interface ClassificationResult {
  cause: RootCause;
  confidence: number;
  ruleId: string;
  /** Human-readable diagnosis. Never prescriptive. */
  explanation: string;
  evidence: string[];
  classifierVersion: string;
  /**
   * Every rule that matched, ordered by precedence (winner first). Lets the
   * audit trail show "also matched X, but Y took precedence".
   */
  candidates: ClassificationCandidate[];
}
