import { fallbackMessageFor } from './fallback-messages';
import { buildCustomerMessagePrompt } from './prompts/customer-message';
import { GeneratedMessageSchema, type AIResult, type GeneratedMessage, type RecoveryMessageInput } from './types';
import type { AIClient } from './client';

export interface MessageGeneratorDeps {
  client: AIClient | null;
}

/**
 * Phase 12 §3/§6 — generate a customer-facing message for an
 * ALREADY-APPROVED recovery action. Never throws: any failure (unavailable,
 * timeout, malformed output, rate limit) falls back to a deterministic
 * template so recovery messaging never blocks payment recovery.
 */
export async function generateRecoveryMessage(
  input: RecoveryMessageInput,
  deps: MessageGeneratorDeps,
): Promise<AIResult<GeneratedMessage>> {
  const language = input.customerLanguage ?? 'EN';

  if (!deps.client) {
    return fallback(input, language);
  }

  try {
    const { system, user } = buildCustomerMessagePrompt(input);
    const outcome = await deps.client.generate({
      operation: 'CUSTOMER_MESSAGE',
      system,
      user,
      schema: GeneratedMessageSchema,
      maxTokens: 512,
    });
    return { value: outcome.value, source: 'AI', model: outcome.model, usage: outcome.usage };
  } catch {
    return fallback(input, language);
  }
}

function fallback(
  input: RecoveryMessageInput,
  language: RecoveryMessageInput['customerLanguage'],
): AIResult<GeneratedMessage> {
  const resolvedLanguage = language ?? 'EN';
  return {
    source: 'FALLBACK',
    value: {
      message: fallbackMessageFor(input.rootCause, resolvedLanguage),
      language: resolvedLanguage,
      reason: 'Deterministic fallback template (AI unavailable, timed out, or returned invalid output).',
    },
  };
}
