import { apiFetch } from './client';
import type { RootCause } from './types';

export interface PendingReviewItem {
  paymentId: string;
  amountMinor: number;
  currency: string;
  failureId: string;
  errorCode: string;
  errorReason: string;
  errorDescription: string;
  currentCause: RootCause;
  currentConfidence: number;
  aiSuggestion: {
    classificationId: string;
    cause: RootCause;
    confidence: number;
    explanation: string | null;
    createdAt: string;
  } | null;
  enteredReviewAt: string;
}

export interface HumanReviewListResult {
  total: number;
  items: PendingReviewItem[];
}

export type HumanReviewDecision = 'ACCEPT' | 'REJECT' | 'KEEP_UNKNOWN';

export interface ResolveReviewResponse {
  status: 'RESOLVED' | 'DUPLICATE';
  duplicate: boolean;
  classificationId: string;
  cause: RootCause;
}

export function listPendingReviews(signal?: AbortSignal): Promise<HumanReviewListResult> {
  return apiFetch<HumanReviewListResult>('/api/human-review', { signal });
}

export function resolveReview(
  failureId: string,
  decision: HumanReviewDecision,
  rootCause?: RootCause,
  reason?: string,
): Promise<ResolveReviewResponse> {
  return apiFetch<ResolveReviewResponse>(
    `/api/human-review/${encodeURIComponent(failureId)}/resolve`,
    { method: 'POST', body: { decision, rootCause, reason } },
  );
}
