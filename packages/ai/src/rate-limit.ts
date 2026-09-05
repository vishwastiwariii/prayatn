import type { AIClient, GenerateArgs, GenerateOutcome } from './client';

/**
 * Phase 14 §12 — a usage ceiling on AI calls.
 *
 * A bug, a retry loop or a load test must not be able to run up an unbounded
 * provider bill. When the ceiling is hit the wrapper throws, and every
 * generator treats a throw exactly like any other AI failure: deterministic
 * fallback, recovery continues. Being rate-limited degrades wording quality —
 * it never blocks a payment.
 */
export interface RateLimitOptions {
  maxCallsPerMinute: number;
  now?: () => number;
}

export function withRateLimit(client: AIClient, options: RateLimitOptions): AIClient {
  const now = options.now ?? (() => Date.now());
  const max = Math.max(1, options.maxCallsPerMinute);
  let windowStart = now();
  let callsInWindow = 0;

  return {
    async generate<T>(args: GenerateArgs<T>): Promise<GenerateOutcome<T>> {
      const t = now();
      if (t - windowStart >= 60_000) {
        windowStart = t;
        callsInWindow = 0;
      }
      if (callsInWindow >= max) {
        throw new Error(
          `AI call budget exhausted (${max}/min) for operation ${args.operation}; using fallback.`,
        );
      }
      callsInWindow += 1;
      return client.generate(args);
    },
  };
}
