import type { AIClient, GenerateArgs, GenerateOutcome } from '../src/client';

/** A client that always succeeds with the given value. */
export function successClient<T>(value: T, model = 'claude-opus-5-test'): AIClient {
  return {
    async generate<U>(args: GenerateArgs<U>): Promise<GenerateOutcome<U>> {
      return {
        value: value as unknown as U,
        model,
        usage: { operation: args.operation, inputTokens: 42, outputTokens: 17, estimatedCostMinor: 1 },
      };
    },
  };
}

export type FailureKind = 'TIMEOUT' | 'INVALID_JSON' | 'INVALID_ENUM' | 'PROVIDER_ERROR' | 'RATE_LIMIT';

/** A client that always fails in a specific documented way (Phase 12 §21/§29). */
export function throwingClient(kind: FailureKind): AIClient {
  return {
    async generate<T>(): Promise<GenerateOutcome<T>> {
      switch (kind) {
        case 'TIMEOUT':
          throw new Error('Request timed out after 8000ms');
        case 'INVALID_JSON':
          throw new Error('Failed to parse structured output: Unexpected token in JSON');
        case 'INVALID_ENUM':
          throw new Error(
            "Failed to parse structured output: invalid_enum_value at 'suggestedRootCause'",
          );
        case 'PROVIDER_ERROR':
          throw new Error('502 Bad Gateway from upstream provider');
        case 'RATE_LIMIT':
          throw new Error('429 Too Many Requests: rate limit exceeded');
      }
    },
  };
}
