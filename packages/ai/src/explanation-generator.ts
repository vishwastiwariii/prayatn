import { buildMerchantExplanationPrompt } from './prompts/merchant-explanation';
import {
  MerchantExplanationSchema,
  type AIResult,
  type MerchantExplanation,
  type MerchantExplanationInput,
} from './types';
import type { AIClient } from './client';

export interface ExplanationGeneratorDeps {
  client: AIClient | null;
}

/**
 * Phase 12 §11-12 — explain a decision the policy engine already made.
 * Falls back to `policy.reason` verbatim so the merchant dashboard keeps
 * working with zero AI dependency.
 */
export async function generateMerchantExplanation(
  input: MerchantExplanationInput,
  deps: ExplanationGeneratorDeps,
): Promise<AIResult<MerchantExplanation>> {
  if (!deps.client) {
    return fallback(input);
  }

  try {
    const { system, user } = buildMerchantExplanationPrompt(input);
    const outcome = await deps.client.generate({
      operation: 'MERCHANT_EXPLANATION',
      system,
      user,
      schema: MerchantExplanationSchema,
      maxTokens: 512,
    });
    return { value: outcome.value, source: 'AI', model: outcome.model, usage: outcome.usage };
  } catch {
    return fallback(input);
  }
}

function fallback(input: MerchantExplanationInput): AIResult<MerchantExplanation> {
  return {
    source: 'FALLBACK',
    value: {
      summary: `${input.recoveryAction} recommended.`,
      explanation: input.reason,
    },
  };
}
