import { apiFetch } from './client';
import type { RecoveryActionType, RootCause } from './types';

export interface RootCauseCount {
  cause: RootCause;
  count: number;
  pct: number;
}

export interface ActionCount {
  action: RecoveryActionType;
  count: number;
  pct: number;
}

export interface ActivityItem {
  id: string;
  createdAt: string;
  paymentId: string | null;
  eventType: string;
  whatWeConcluded: string;
  whatWeDid: string;
}

export interface DashboardSummary {
  funnel: {
    initiallyFailed: number;
    classified: number;
    eligible: number;
    attempted: number;
    recovered: number;
  };
  recovery: {
    amountRecoveredMinor: number;
    attemptsConsumed: number;
    messagesSent: number;
    hardStops: number;
    humanReview: number;
    costPerRecoveryMinor: number | null;
  };
  rootCauses: RootCauseCount[];
  actions: ActionCount[];
  recentActivity: ActivityItem[];
  costModel: { perAttemptMinor: number; perMessageMinor: number };
}

export function getDashboardSummary(signal?: AbortSignal): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/dashboard/summary', { signal });
}
