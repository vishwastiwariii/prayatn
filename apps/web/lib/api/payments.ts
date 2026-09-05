import { apiFetch } from './client';
import type {
  ClassificationSource,
  PaymentMethod,
  RecoveryActionType,
  RecoveryStatus,
  RootCause,
} from './types';

export interface PaymentListFilters {
  status?: RecoveryStatus;
  cause?: RootCause;
  method?: PaymentMethod;
  action?: RecoveryActionType;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentListItem {
  paymentId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  status: string;
  recoveryStatus: RecoveryStatus | null;
  attemptCount: number;
  cause: RootCause | null;
  confidence: number | null;
  action: RecoveryActionType | null;
  actionStatus: string | null;
  maxAttempts: number | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentListResult {
  items: PaymentListItem[];
  total: number;
  limit: number;
  offset: number;
}

export type MessageSource = 'AI' | 'FALLBACK';

export interface PaymentDetail {
  payment: {
    id: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod;
    status: string;
    recoveryStatus: RecoveryStatus | null;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
  };
  customer: { id: string; name: string; balanceState: string; salaryDay: number | null } | null;
  failures: Array<{
    id: string;
    errorCode: string;
    errorReason: string;
    errorSource: string;
    errorStep: string;
    errorDescription: string;
    occurredAt: string;
    classifications: Array<{
      id: string;
      cause: RootCause;
      confidence: number;
      ruleId: string | null;
      source: ClassificationSource;
      evidence: string[];
      explanation: string | null;
      createdAt: string;
    }>;
  }>;
  recoveryActions: Array<{
    id: string;
    cause: RootCause;
    action: RecoveryActionType;
    status: string;
    attemptNumber: number;
    scheduledFor: string | null;
    reason: string | null;
    delayMinutes: number | null;
    maxAttempts: number | null;
    requiresCustomerMessage: boolean;
    createdAt: string;
    executedAt: string | null;
    outcome: {
      status: string;
      amountRecoveredMinor: number;
      gatewayLatencyMs: number | null;
      failureReason: string | null;
      occurredAt: string;
    } | null;
  }>;
  messages: Array<{
    id: string;
    recoveryActionId: string;
    channel: string;
    language: string;
    content: string;
    reason: string;
    source: MessageSource;
    createdAt: string;
  }>;
  auditTimeline: Array<{
    id: string;
    eventType: string;
    whatWeSaw: string;
    whatWeConcluded: string;
    whatWasAllowed: string;
    whatWeDid: string;
    whatHappened: string;
    createdAt: string;
  }>;
}

export function listPayments(
  filters: PaymentListFilters = {},
  signal?: AbortSignal,
): Promise<PaymentListResult> {
  return apiFetch<PaymentListResult>('/api/payments', {
    searchParams: filters as Record<string, string | number | undefined>,
    signal,
  });
}

export function getPayment(paymentId: string, signal?: AbortSignal): Promise<PaymentDetail> {
  return apiFetch<PaymentDetail>(`/api/payments/${encodeURIComponent(paymentId)}`, { signal });
}

export function decideRecovery(failureId: string): Promise<unknown> {
  return apiFetch(`/api/payments/failures/${encodeURIComponent(failureId)}/decide`, {
    method: 'POST',
  });
}
