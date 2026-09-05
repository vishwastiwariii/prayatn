import { ROOT_CAUSE_LABEL, RECOVERY_ACTION_LABEL } from '../labels';
import type { MerchantExplanationInput } from '../types';

/**
 * Phase 12 §11 — the AI explains a decision the policy engine already made.
 * It must not reinterpret or contradict `input.reason`; the prompt hands
 * that reason over as a fact to restate in plain English, not a suggestion.
 */
export function buildMerchantExplanationPrompt(input: MerchantExplanationInput): {
  system: string;
  user: string;
} {
  const system = [
    'You explain payment-recovery decisions to a merchant operator watching a dashboard.',
    'A deterministic policy engine already made the decision below — you are explaining it, not',
    'making it or second-guessing it. Do not contradict, soften, or reinterpret the given reason.',
    'Be plain, factual, and brief. No speculation about outcomes the system did not state.',
  ].join('\n');

  const facts = [
    `payment_method: ${input.paymentMethod}`,
    `root_cause: ${ROOT_CAUSE_LABEL[input.rootCause]}`,
    `classification_confidence: ${Math.round(input.confidence * 100)}%`,
    `approved_action: ${RECOVERY_ACTION_LABEL[input.recoveryAction]}`,
    `policy_reason: ${input.reason}`,
    `attempts: ${input.attempts}${input.maxAttempts != null ? ` of ${input.maxAttempts}` : ''}`,
  ].join('\n');

  const user = [
    'Write a merchant-facing summary and explanation for this decision.',
    '',
    '<decision_facts>',
    facts,
    '</decision_facts>',
  ].join('\n');

  return { system, user };
}
