'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDashboardSummary } from './api/dashboard';
import { getGatewayCircuit } from './api/gateway';
import { getEvaluation, startEvaluation, type StartEvaluationOptions } from './api/evaluation';
import { getPayment, listPayments, type PaymentListFilters } from './api/payments';
import {
  listPendingReviews,
  resolveReview,
  type HumanReviewDecision,
} from './api/human-review';
import { generateAISuggestion, generateCustomerMessage, generateMerchantExplanation } from './api/ai';
import {
  advanceDemo,
  drainDemo,
  getDemoHealth,
  getDemoState,
  resetDemo,
  startDemo,
} from './api/demo';
import type { RootCause } from './api/types';
import { useDocumentVisible } from './use-document-visible';

/** Phase 11 §26 — suggested polling intervals; paused while the tab is hidden. */
const INTERVALS = {
  dashboard: 5000,
  gateway: 2000,
  payments: 3000,
  paymentDetail: 3000,
  humanReview: 5000,
};

export function useDashboardSummary() {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: ({ signal }) => getDashboardSummary(signal),
    refetchInterval: visible ? INTERVALS.dashboard : false,
  });
}

export function useGatewayCircuit() {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['gateway-circuit'],
    queryFn: ({ signal }) => getGatewayCircuit(signal),
    refetchInterval: visible ? INTERVALS.gateway : false,
  });
}

export function usePayments(filters: PaymentListFilters) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['payments', filters],
    queryFn: ({ signal }) => listPayments(filters, signal),
    refetchInterval: visible ? INTERVALS.payments : false,
    placeholderData: (prev) => prev,
  });
}

export function usePaymentDetail(paymentId: string | null) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['payment', paymentId],
    queryFn: ({ signal }) => getPayment(paymentId as string, signal),
    enabled: paymentId != null,
    refetchInterval: visible ? INTERVALS.paymentDetail : false,
  });
}

export function useEvaluation(options: StartEvaluationOptions) {
  return useQuery({
    queryKey: ['evaluation', options],
    queryFn: async () => {
      const { evaluationId } = await startEvaluation(options);
      return getEvaluation(evaluationId);
    },
    staleTime: 60_000,
  });
}

export function useHumanReviewQueue() {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['human-review'],
    queryFn: ({ signal }) => listPendingReviews(signal),
    refetchInterval: visible ? INTERVALS.humanReview : false,
  });
}

/** Invalidates every view a human-review / AI-generation action can affect. */
function useInvalidateAfterReviewAction() {
  const queryClient = useQueryClient();
  return (paymentId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['human-review'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    if (paymentId) void queryClient.invalidateQueries({ queryKey: ['payment', paymentId] });
  };
}

export function useResolveReview(paymentId?: string) {
  const invalidate = useInvalidateAfterReviewAction();
  return useMutation({
    mutationFn: (args: { failureId: string; decision: HumanReviewDecision; rootCause?: RootCause; reason?: string }) =>
      resolveReview(args.failureId, args.decision, args.rootCause, args.reason),
    onSuccess: () => invalidate(paymentId),
  });
}

export function useGenerateAISuggestion(paymentId?: string) {
  const invalidate = useInvalidateAfterReviewAction();
  return useMutation({
    mutationFn: (failureId: string) => generateAISuggestion(failureId),
    onSuccess: () => invalidate(paymentId),
  });
}

export function useGenerateCustomerMessage(paymentId: string) {
  const invalidate = useInvalidateAfterReviewAction();
  return useMutation({
    mutationFn: (recoveryActionId: string) => generateCustomerMessage(recoveryActionId),
    onSuccess: () => invalidate(paymentId),
  });
}

export function useGenerateMerchantExplanation() {
  return useMutation({
    mutationFn: (recoveryActionId: string) => generateMerchantExplanation(recoveryActionId),
  });
}

// ---------------------------------------------------------------------------
// Phase 13 — demo mode
// ---------------------------------------------------------------------------

export function useDemoState(pollMs = 2000) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: ['demo-state'],
    queryFn: ({ signal }) => getDemoState(signal),
    refetchInterval: visible ? pollMs : false,
  });
}

export function useDemoHealth() {
  return useQuery({
    queryKey: ['demo-health'],
    queryFn: ({ signal }) => getDemoHealth(signal),
    staleTime: 5_000,
  });
}

function useInvalidateDemo() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['demo-state'] });
    void queryClient.invalidateQueries({ queryKey: ['demo-health'] });
    void queryClient.invalidateQueries({ queryKey: ['gateway-circuit'] });
  };
}

export function useDemoControls() {
  const invalidate = useInvalidateDemo();
  const reset = useMutation({ mutationFn: resetDemo, onSuccess: invalidate });
  const start = useMutation({ mutationFn: startDemo, onSuccess: invalidate });
  const advance = useMutation({ mutationFn: advanceDemo, onSuccess: invalidate });
  const drain = useMutation({ mutationFn: drainDemo, onSuccess: invalidate });
  return { reset, start, advance, drain };
}
