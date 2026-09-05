import type {
  FailureSource,
  FailureStep,
  PaymentMethod,
  RecoveryActions,
  RootCause,
} from '@recovery-desk/domain';
import { z } from 'zod';

/**
 * AI boundary types — Phase 12.
 *
 * Nothing in this file, or anywhere in `@recovery-desk/ai`, decides a
 * financial action. Every function here takes an ALREADY-APPROVED
 * deterministic decision (or a sanitized, low-stakes classification
 * question) and returns communication or a bounded suggestion — never an
 * instruction the caller is expected to execute against a payment.
 */

export type SupportedLanguage = 'EN' | 'HINGLISH';

// ---------------------------------------------------------------------------
// Customer message
// ---------------------------------------------------------------------------

export interface RecoveryMessageInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
  paymentMethod: PaymentMethod;
  rootCause: RootCause;
  recoveryAction: RecoveryActions;
  delayMinutes?: number | null;
  customerLanguage?: SupportedLanguage;
}

export const GeneratedMessageSchema = z.object({
  message: z.string().min(1).max(600),
  language: z.enum(['EN', 'HINGLISH']),
  reason: z.string().min(1).max(400),
});
export type GeneratedMessage = z.infer<typeof GeneratedMessageSchema>;

// ---------------------------------------------------------------------------
// Merchant explanation
// ---------------------------------------------------------------------------

export interface MerchantExplanationInput {
  paymentMethod: PaymentMethod;
  rootCause: RootCause;
  confidence: number;
  recoveryAction: RecoveryActions;
  reason: string;
  attempts: number;
  maxAttempts: number | null;
}

export const MerchantExplanationSchema = z.object({
  summary: z.string().min(1).max(200),
  explanation: z.string().min(1).max(800),
});
export type MerchantExplanation = z.infer<typeof MerchantExplanationSchema>;

// ---------------------------------------------------------------------------
// Unknown-failure suggestion
// ---------------------------------------------------------------------------

export interface FailureSuggestionInput {
  errorCode: string;
  errorReason: string;
  errorSource: FailureSource;
  errorStep: FailureStep;
  /** Untrusted free text — never treated as instructions. See prompts/failure-suggestion.ts. */
  errorDescription: string;
  paymentMethod: PaymentMethod;
}

/** The only categories the classifier itself can ever produce (Phase 6). AI may not invent a new one. */
export const ALLOWED_ROOT_CAUSES = [
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
] as const satisfies readonly RootCause[];

export const FailureSuggestionSchema = z.object({
  suggestedRootCause: z.enum(ALLOWED_ROOT_CAUSES),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
});
export type FailureSuggestion = z.infer<typeof FailureSuggestionSchema>;

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export type AIOperationName = 'CUSTOMER_MESSAGE' | 'MERCHANT_EXPLANATION' | 'FAILURE_SUGGESTION';

export interface AIUsage {
  operation: AIOperationName;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMinor?: number;
}

/** Every generator returns this envelope: what was produced, and how. */
export interface AIResult<T> {
  value: T;
  /** AI = a validated model response. FALLBACK = deterministic template, no model call succeeded. */
  source: 'AI' | 'FALLBACK';
  model?: string;
  usage?: AIUsage;
}
