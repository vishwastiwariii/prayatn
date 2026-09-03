import type {
  ClassificationCandidate,
  ClassificationResult,
  ClassifierInput,
  NormalizedInput,
} from './types';
import { normalizeInput } from './normalize';
import { RULES } from './rules';
import { CLASSIFIER_VERSION } from './version';

/** Confidence assigned when no rule matches. Deliberately low. */
export const UNKNOWN_CONFIDENCE = 0.2;
export const UNKNOWN_RULE_ID = 'UNKNOWN_FALLBACK';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministically diagnose a persisted payment failure.
 *
 *   normalize -> evaluate EVERY rule -> order matches by explicit precedence
 *             -> winner = lowest priority -> build explanation
 *
 * Pure: same input always yields a deep-equal result. No IO, no clock, no
 * randomness. This function DIAGNOSES ONLY — it never selects a recovery
 * action; that is the policy engine's job (Phase 7).
 */
export function classify(input: ClassifierInput): ClassificationResult {
  const n: NormalizedInput = normalizeInput(input);

  const candidates: ClassificationCandidate[] = RULES.flatMap((rule) => {
    const evaluation = rule.evaluate(n);
    if (!evaluation.matched) return [];
    return [
      {
        ruleId: rule.id,
        cause: rule.cause,
        priority: rule.priority,
        confidence: round2(evaluation.confidence),
        strength: evaluation.strength,
        evidence: evaluation.evidence,
      },
    ];
  }).sort((a, b) => a.priority - b.priority);

  if (candidates.length === 0) {
    return {
      cause: 'UNKNOWN',
      confidence: UNKNOWN_CONFIDENCE,
      ruleId: UNKNOWN_RULE_ID,
      explanation:
        `No deterministic rule matched this failure signature ` +
        `(reason="${n.reason}", source=${n.source}, step=${n.step}). ` +
        `The root cause could not be identified from the available error fields.`,
      evidence: [
        'no_rule_matched',
        `reason=${n.reason}`,
        `code=${n.code}`,
        `source=${n.source}`,
        `step=${n.step}`,
      ],
      classifierVersion: CLASSIFIER_VERSION,
      candidates: [],
    };
  }

  const [winner, ...rest] = candidates as [ClassificationCandidate, ...ClassificationCandidate[]];
  const winningRule = RULES.find((r) => r.id === winner.ruleId);

  let explanation = `${winningRule?.description ?? ''} `.trimStart();
  explanation +=
    `Matched rule ${winner.ruleId} (${winner.strength}) at ${Math.round(winner.confidence * 100)}% confidence. ` +
    `Signals: ${winner.evidence.join(', ')}.`;
  if (rest.length > 0) {
    explanation +=
      ` Also matched ${rest.map((c) => `${c.cause} (${c.ruleId})`).join(', ')}, ` +
      `but ${winner.cause} takes precedence.`;
  }

  return {
    cause: winner.cause,
    confidence: winner.confidence,
    ruleId: winner.ruleId,
    explanation,
    evidence: winner.evidence,
    classifierVersion: CLASSIFIER_VERSION,
    candidates,
  };
}
