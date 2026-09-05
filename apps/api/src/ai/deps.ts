import { liveAIClient, type AIClient } from '@recovery-desk/ai';

/**
 * The single place the API wires an `AIClient` for the whole app. `null`
 * means no credentials are configured — every generator in `@recovery-desk/ai`
 * treats that exactly like a failed call (deterministic fallback).
 */
export function getLiveAIClient(): AIClient | null {
  return liveAIClient();
}
