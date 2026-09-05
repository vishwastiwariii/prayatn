import { apiFetch } from './client';
import type { MessageSource } from './payments';
import type { PaymentMethod, RecoveryActionType, RootCause } from './types';

export type DemoStage =
  | 'READY'
  | 'FAILURES'
  | 'CLASSIFICATION'
  | 'RECOVERY_DECISIONS'
  | 'GATEWAY_STORM'
  | 'CIRCUIT_OPEN'
  | 'GATEWAY_RECOVERY'
  | 'RECOVERY_RESUMED'
  | 'AI_MESSAGE'
  | 'HUMAN_REVIEW'
  | 'RESULTS'
  | 'COMPLETE';

export interface DemoStageMeta {
  stage: DemoStage;
  title: string;
  headline: string;
  nextLabel: string;
  waitsOnSystem?: boolean;
}

export interface DemoEvent {
  id: string;
  timestamp: number;
  stage: DemoStage;
  type: string;
  message: string;
}

export interface DemoCounters {
  failures: number;
  classified: number;
  decisions: number;
  queued: number;
  blockedByCircuit: number;
  recovered: number;
  hardStopped: number;
  humanReview: number;
  messagesGenerated: number;
  amountAtRiskMinor: number;
  amountRecoveredMinor: number;
}

export interface DemoPaymentView {
  paymentId: string;
  amountMinor: number;
  method: PaymentMethod;
  status: string;
  recoveryStatus: string | null;
  note: string | null;
  failure: { id: string; code: string; reason: string } | null;
  classification: {
    cause: RootCause | null;
    confidence: number | null;
    source: string | null;
    ruleId: string | null;
  } | null;
  aiSuggestion: { cause: RootCause; confidence: number; explanation: string | null } | null;
  action: {
    id: string;
    action: RecoveryActionType;
    status: string;
    delayMinutes: number | null;
    attemptNumber: number;
    maxAttempts: number | null;
    reason: string | null;
  } | null;
  message: { content: string; language: string; source: MessageSource } | null;
}

export interface DemoConstants {
  seed: number;
  datasetVersion: string;
  amountAtRiskMinor: number;
  paymentCount: number;
  stormDurationMinutes: number;
  circuit: {
    failureThreshold: number;
    failureWindowSeconds: number;
    openCooldownSeconds: number;
    halfOpenMaxProbes: number;
  };
  drain: { batchSize: number };
}

export interface DemoState {
  demoId: string | null;
  stage: DemoStage;
  seed: number;
  datasetVersion: string;
  startedAt: number | null;
  events: DemoEvent[];
  meta: DemoStageMeta;
  stages: DemoStageMeta[];
  constants: DemoConstants;
  counters: DemoCounters;
  payments: DemoPaymentView[];
}

export interface DemoHealth {
  database: boolean;
  redis: boolean;
  api: boolean;
  worker: boolean;
  simulator: boolean;
  circuitBreaker: boolean;
  evaluation: boolean;
  ai: boolean;
  details: Record<string, string>;
  configError: {
    expectedSeed: number;
    expectedDatasetVersion: string;
    actualSeed: number;
    actualDatasetVersion: string;
  } | null;
}

export interface DemoAdvanceResponse {
  status: 'ADVANCED';
  from: DemoStage;
  to: DemoStage;
  meta: DemoStageMeta;
  detail: Record<string, unknown>;
}

export function getDemoState(signal?: AbortSignal): Promise<DemoState> {
  return apiFetch<DemoState>('/api/demo/state', { signal });
}

export function getDemoHealth(signal?: AbortSignal): Promise<DemoHealth> {
  return apiFetch<DemoHealth>('/api/demo/health', { signal });
}

export function resetDemo(): Promise<{ status: string }> {
  return apiFetch('/api/demo/reset', { method: 'POST' });
}

export function startDemo(): Promise<{ demoId: string; seed: number; datasetVersion: string }> {
  return apiFetch('/api/demo/start', { method: 'POST' });
}

export function advanceDemo(): Promise<DemoAdvanceResponse> {
  return apiFetch<DemoAdvanceResponse>('/api/demo/advance', { method: 'POST' });
}

export function drainDemo(): Promise<{ status: string; detail: Record<string, unknown> }> {
  return apiFetch('/api/demo/drain', { method: 'POST' });
}
