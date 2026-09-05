import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { AIOperationName, AIUsage } from './types';

/**
 * The only place `@anthropic-ai/sdk` is imported. Every AI generator talks to
 * this narrow interface, never to the SDK directly — that's what makes the
 * generators testable without a network call and swappable if the provider
 * ever changes.
 */
export interface GenerateArgs<T> {
  operation: AIOperationName;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface GenerateOutcome<T> {
  value: T;
  model: string;
  usage?: AIUsage;
}

export interface AIClient {
  generate<T>(args: GenerateArgs<T>): Promise<GenerateOutcome<T>>;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 8000;

/** True when credentials are present, without making a network call. */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function estimateCostMinor(inputTokens: number, outputTokens: number): number {
  // Opus 5 list pricing: $5/1M input, $25/1M output. Minor units of ₹ are
  // irrelevant here — this is a $-denominated observability estimate, kept in
  // "minor" units (cents) for consistency with the rest of the app's money
  // fields. Never used to gate recovery behavior (Phase 12 §28).
  const inputCents = (inputTokens / 1_000_000) * 500;
  const outputCents = (outputTokens / 1_000_000) * 2500;
  return Math.round(inputCents + outputCents);
}

export interface CreateAnthropicClientOptions {
  apiKey?: string;
  model?: string;
}

export function createAnthropicClient(options: CreateAnthropicClientOptions = {}): AIClient {
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const sdk = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : undefined);

  return {
    async generate<T>({
      system,
      user,
      schema,
      maxTokens = DEFAULT_MAX_TOKENS,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      operation,
    }: GenerateArgs<T>): Promise<GenerateOutcome<T>> {
      const response = await sdk.beta.messages.parse(
        {
          model,
          max_tokens: maxTokens,
          system: [
            {
              type: 'text',
              text: system,
            },
          ],
          messages: [{ role: 'user', content: user }],
          output_format: betaZodOutputFormat(schema),
        },
        { timeout: timeoutMs },
      );

      if (response.stop_reason === 'refusal') {
        throw new Error(`AI refused the request for operation ${operation}`);
      }
      if (response.parsed_output == null) {
        throw new Error(`AI response for operation ${operation} failed schema validation`);
      }

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;

      return {
        value: response.parsed_output,
        model: response.model,
        usage: {
          operation,
          inputTokens,
          outputTokens,
          estimatedCostMinor: estimateCostMinor(inputTokens, outputTokens),
        },
      };
    },
  };
}
