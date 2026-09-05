import { buildFailureSuggestionPrompt } from './prompts/failure-suggestion';
import {
  FailureSuggestionSchema,
  type AIResult,
  type FailureSuggestion,
  type FailureSuggestionInput,
} from './types';
import type { AIClient } from './client';

export interface FailureSuggesterDeps {
  client: AIClient | null;
}

/**
 * Phase 12 §13-16 — suggest a root cause for an UNKNOWN/low-confidence
 * failure. This NEVER becomes the official classification by itself; the
 * caller (apps/api) always persists it as `source=LLM_SUGGESTION`, which is
 * excluded from the set the policy engine treats as authoritative (only
 * RULE/HUMAN are). An invalid or unavailable response falls back to
 * UNKNOWN at confidence 0 — never a guess dressed up as a real number.
 */
export async function suggestFailureCause(
  input: FailureSuggestionInput,
  deps: FailureSuggesterDeps,
): Promise<AIResult<FailureSuggestion>> {
  if (!deps.client) {
    return fallback();
  }

  try {
    const { system, user } = buildFailureSuggestionPrompt(input);
    const outcome = await deps.client.generate({
      operation: 'FAILURE_SUGGESTION',
      system,
      user,
      schema: FailureSuggestionSchema,
      maxTokens: 512,
    });
    return { value: outcome.value, source: 'AI', model: outcome.model, usage: outcome.usage };
  } catch {
    return fallback();
  }
}

function fallback(): AIResult<FailureSuggestion> {
  return {
    source: 'FALLBACK',
    value: {
      suggestedRootCause: 'UNKNOWN',
      confidence: 0,
      explanation: 'AI suggestion unavailable (provider unreachable, timed out, or returned invalid output).',
    },
  };
}
