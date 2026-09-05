import { apiFetch } from './client';
import type { MessageSource } from './payments';
import type { RootCause } from './types';

export interface RecoveryMessageView {
  id: string;
  paymentId: string;
  recoveryActionId: string;
  channel: string;
  language: string;
  content: string;
  reason: string;
  source: MessageSource;
  createdAt: string;
}

export interface GenerateMessageResponse {
  status: 'CREATED' | 'DUPLICATE';
  duplicate: boolean;
  message: RecoveryMessageView;
}

export function generateCustomerMessage(recoveryActionId: string): Promise<GenerateMessageResponse> {
  return apiFetch<GenerateMessageResponse>(
    `/api/recovery-actions/${encodeURIComponent(recoveryActionId)}/message`,
    { method: 'POST' },
  );
}

export interface AISuggestionView {
  classificationId: string;
  failureId: string;
  suggestedRootCause: RootCause;
  confidence: number;
  explanation: string | null;
  source: MessageSource;
  createdAt: string;
}

export interface GenerateSuggestionResponse {
  status: 'CREATED' | 'DUPLICATE';
  duplicate: boolean;
  suggestion: AISuggestionView;
}

export function generateAISuggestion(failureId: string): Promise<GenerateSuggestionResponse> {
  return apiFetch<GenerateSuggestionResponse>(
    `/api/payments/failures/${encodeURIComponent(failureId)}/ai-suggestion`,
    { method: 'POST' },
  );
}

export interface MerchantExplanation {
  summary: string;
  explanation: string;
}

export interface GenerateExplanationResponse {
  status: 'OK';
  source: MessageSource;
  explanation: MerchantExplanation;
}

export function generateMerchantExplanation(recoveryActionId: string): Promise<GenerateExplanationResponse> {
  return apiFetch<GenerateExplanationResponse>(
    `/api/recovery-actions/${encodeURIComponent(recoveryActionId)}/explanation`,
    { method: 'POST' },
  );
}
