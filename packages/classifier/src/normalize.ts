import type { ClassifierInput, NormalizedInput } from './types';

/** Lowercase, trim, collapse separators to single underscores. */
export function canonical(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeInput(input: ClassifierInput): NormalizedInput {
  const reason = canonical(input.errorReason);
  const code = canonical(input.errorCode);
  const description = input.errorDescription.trim().toLowerCase();

  return {
    raw: input,
    reason,
    code,
    description,
    source: input.errorSource,
    step: input.errorStep,
    method: input.method,
    reasonTokens: new Set(reason.split(/[^a-z0-9]+/).filter(Boolean)),
  };
}

/** Whole-token match against the (canonicalised) reason. */
export function reasonHasToken(n: NormalizedInput, token: string): boolean {
  return n.reasonTokens.has(token);
}

/** Substring match anywhere in reason OR free-text description. */
export function textIncludes(n: NormalizedInput, needle: string): boolean {
  return n.reason.includes(needle) || n.description.includes(needle);
}
