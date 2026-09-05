import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import type { AIClient, GenerateArgs, GenerateOutcome } from './client';
import type { AIOperationName } from './types';

/**
 * The OpenAI provider. Implements the exact same `AIClient` contract as
 * `client.ts`'s Anthropic implementation — every generator in this package
 * (`message-generator.ts`, `explanation-generator.ts`, `failure-suggester.ts`)
 * talks to that contract only, so switching providers here never touches
 * prompts, fallback logic, or the Phase 12 safety boundary.
 */

/**
 * A solid, inexpensive, structured-outputs-capable default. Override with
 * `OPENAI_MODEL` if you want a different one (e.g. a newer flagship model) —
 * any Chat Completions model that supports `response_format: json_schema`
 * works here unchanged.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 8000;

/** True when credentials are present, without making a network call. */
export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function estimateCostMinor(inputTokens: number, outputTokens: number): number {
  // gpt-4o-mini list pricing as of writing: $0.15/1M input, $0.60/1M output.
  // Approximate and provider-specific — override this estimate by pointing
  // OPENAI_MODEL at a different model's own pricing if you need accuracy.
  // Observability only; never gates recovery behavior (Phase 12 §28).
  const inputCents = (inputTokens / 1_000_000) * 15;
  const outputCents = (outputTokens / 1_000_000) * 60;
  return Math.round(inputCents + outputCents);
}

export interface CreateOpenAIClientOptions {
  apiKey?: string;
  model?: string;
  /** Override the default API host, e.g. for an Azure OpenAI / proxy endpoint. */
  baseURL?: string;
}

export function createOpenAIClient(options: CreateOpenAIClientOptions = {}): AIClient {
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const sdk = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL,
  });

  return {
    async generate<T>({
      system,
      user,
      schema,
      maxTokens = DEFAULT_MAX_TOKENS,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      operation,
    }: GenerateArgs<T>): Promise<GenerateOutcome<T>> {
      const completion = await sdk.chat.completions.parse(
        {
          model,
          max_completion_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: zodResponseFormat(schema as z.ZodType<T>, operationSchemaName(operation)),
        },
        { timeout: timeoutMs },
      );

      const choice = completion.choices[0];
      const message = choice?.message;

      if (message?.refusal) {
        throw new Error(`AI refused the request for operation ${operation}: ${message.refusal}`);
      }
      if (message?.parsed == null) {
        throw new Error(`AI response for operation ${operation} failed schema validation`);
      }

      return {
        value: message.parsed,
        model: completion.model,
        usage: {
          operation,
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          estimatedCostMinor:
            completion.usage != null
              ? estimateCostMinor(completion.usage.prompt_tokens, completion.usage.completion_tokens)
              : undefined,
        },
      };
    },
  };
}

function operationSchemaName(operation: AIOperationName): string {
  return operation.toLowerCase();
}
