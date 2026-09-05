import { createAnthropicClient, isAnthropicConfigured, type AIClient } from './client';
import { createOpenAIClient, isOpenAIConfigured } from './openai-client';
import { withRateLimit } from './rate-limit';

/**
 * Picks the configured LLM provider from environment variables. `null` when
 * nothing is configured — every generator treats that exactly like a failed
 * call (Phase 12 §21: AI unavailable -> fallback -> recovery continues).
 * Callers should not gate on this themselves; just pass the result straight
 * to a generator's deps.
 *
 *   AI_PROVIDER=openai    + OPENAI_API_KEY    (+ optional OPENAI_MODEL / OPENAI_BASE_URL)
 *   AI_PROVIDER=anthropic + ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL)
 *
 * `AI_PROVIDER` is optional: with it unset, whichever key is present wins
 * (OpenAI first, then Anthropic). Setting `AI_PROVIDER` explicitly is only
 * useful when both keys happen to be set and you want to pin one.
 */
export function liveAIClient(): AIClient | null {
  const client = selectProvider();
  if (!client) return null;
  // Phase 14 §12 — a runaway loop cannot run up an unbounded provider bill.
  const maxCallsPerMinute = Number(process.env.AI_MAX_CALLS_PER_MINUTE ?? 60);
  return withRateLimit(client, { maxCallsPerMinute });
}

function selectProvider(): AIClient | null {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (provider === 'openai') {
    return isOpenAIConfigured() ? createOpenAIClient() : null;
  }
  if (provider === 'anthropic') {
    return isAnthropicConfigured() ? createAnthropicClient() : null;
  }

  if (isOpenAIConfigured()) return createOpenAIClient();
  if (isAnthropicConfigured()) return createAnthropicClient();
  return null;
}
