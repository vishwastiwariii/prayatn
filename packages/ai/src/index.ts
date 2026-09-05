/**
 * `@recovery-desk/ai` — the ONLY package allowed to call an LLM (Phase 12).
 *
 *   Deterministic system (classifier, policy engine, circuit breaker, gateway)
 *     -> approved context ->
 *   AI (customer messages, merchant explanations, unknown-failure suggestions)
 *
 * Nothing exported here can authorize a payment, change a retry limit,
 * override the policy engine, switch a rail, bypass a hard stop, execute a
 * payment, or touch circuit-breaker state. See each generator's docstring for
 * its specific fallback guarantee.
 */
export {
  ALLOWED_ROOT_CAUSES,
  GeneratedMessageSchema,
  MerchantExplanationSchema,
  FailureSuggestionSchema,
} from './types';
export type {
  SupportedLanguage,
  RecoveryMessageInput,
  GeneratedMessage,
  MerchantExplanationInput,
  MerchantExplanation,
  FailureSuggestionInput,
  FailureSuggestion,
  AIOperationName,
  AIUsage,
  AIResult,
} from './types';

export { fallbackMessageFor } from './fallback-messages';

export { generateRecoveryMessage } from './message-generator';
export type { MessageGeneratorDeps } from './message-generator';

export { generateMerchantExplanation } from './explanation-generator';
export type { ExplanationGeneratorDeps } from './explanation-generator';

export { suggestFailureCause } from './failure-suggester';
export type { FailureSuggesterDeps } from './failure-suggester';

export { createAnthropicClient, isAnthropicConfigured, DEFAULT_ANTHROPIC_MODEL } from './client';
export type { AIClient, GenerateArgs, GenerateOutcome, CreateAnthropicClientOptions } from './client';

export { createOpenAIClient, isOpenAIConfigured, DEFAULT_OPENAI_MODEL } from './openai-client';
export type { CreateOpenAIClientOptions } from './openai-client';

export { liveAIClient } from './live';

export { withRateLimit } from './rate-limit';
export type { RateLimitOptions } from './rate-limit';

export { buildCustomerMessagePrompt } from './prompts/customer-message';
export { buildMerchantExplanationPrompt } from './prompts/merchant-explanation';
export { buildFailureSuggestionPrompt } from './prompts/failure-suggestion';
