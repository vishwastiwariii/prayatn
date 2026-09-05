/**
 * Phase 13 — the demo's deterministic state machine.
 *
 * This package is PURE: it owns the stage order, the copy for each stage and
 * a bounded event log. It never touches the database, the queue, the circuit
 * breaker or the AI — apps/api performs the real work for each stage and
 * reports back. That separation is what keeps the demo honest: the narrative
 * is scripted, the system behaviour is not.
 */

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

/** Stage order. `advance()` only ever moves one step along this list. */
export const DEMO_STAGES: readonly DemoStage[] = [
  'READY',
  'FAILURES',
  'CLASSIFICATION',
  'RECOVERY_DECISIONS',
  'GATEWAY_STORM',
  'CIRCUIT_OPEN',
  'GATEWAY_RECOVERY',
  'RECOVERY_RESUMED',
  'AI_MESSAGE',
  'HUMAN_REVIEW',
  'RESULTS',
  'COMPLETE',
] as const;

export interface DemoStageMeta {
  stage: DemoStage;
  /** Short title shown on the stage stepper. */
  title: string;
  /** What the presenter is demonstrating here. */
  headline: string;
  /** The label for the button that advances OUT of this stage. */
  nextLabel: string;
  /**
   * True when leaving this stage waits on real system state rather than a
   * click (the circuit breaker's real cooldown). The UI shows a countdown.
   */
  waitsOnSystem?: boolean;
}

export const DEMO_STAGE_META: Record<DemoStage, DemoStageMeta> = {
  READY: {
    stage: 'READY',
    title: 'Ready',
    headline: 'A clean, seeded environment. Nothing has failed yet.',
    nextLabel: 'Ingest payment failures',
  },
  FAILURES: {
    stage: 'FAILURES',
    title: 'Failures',
    headline: 'Payments failed. Every one of them is a different problem.',
    nextLabel: 'Diagnose them',
  },
  CLASSIFICATION: {
    stage: 'CLASSIFICATION',
    title: 'Diagnosis',
    headline: 'Deterministic rules assign a root cause, a confidence and evidence.',
    nextLabel: 'Decide what is safe to do',
  },
  RECOVERY_DECISIONS: {
    stage: 'RECOVERY_DECISIONS',
    title: 'Decisions',
    headline: 'Different failures get different recovery strategies — not one retry button.',
    nextLabel: 'Simulate a gateway outage',
  },
  GATEWAY_STORM: {
    stage: 'GATEWAY_STORM',
    title: 'Gateway storm',
    headline: 'The gateway starts returning 5xx. Retries would amplify the outage.',
    nextLabel: 'Show what the breaker did',
  },
  CIRCUIT_OPEN: {
    stage: 'CIRCUIT_OPEN',
    title: 'Circuit open',
    headline: 'Recovery Desk stopped calling the gateway. Blocked is not lost.',
    nextLabel: 'Recover the gateway',
    waitsOnSystem: true,
  },
  GATEWAY_RECOVERY: {
    stage: 'GATEWAY_RECOVERY',
    title: 'Half-open probe',
    headline: 'After the cooldown, exactly one probe request is allowed through.',
    nextLabel: 'Drain the queue',
  },
  RECOVERY_RESUMED: {
    stage: 'RECOVERY_RESUMED',
    title: 'Controlled drain',
    headline: 'The queue resumes in batches — recovery without a retry storm.',
    nextLabel: 'Write the customer message',
  },
  AI_MESSAGE: {
    stage: 'AI_MESSAGE',
    title: 'AI message',
    headline: 'The decision was already made. AI only turns it into words.',
    nextLabel: 'Show the unknown failure',
  },
  HUMAN_REVIEW: {
    stage: 'HUMAN_REVIEW',
    title: 'Human review',
    headline: 'AI suggests. A human decides. The suggestion is never authoritative.',
    nextLabel: 'Show the results',
  },
  RESULTS: {
    stage: 'RESULTS',
    title: 'Results',
    headline: 'Same dataset, same hidden state — only the strategy changed.',
    nextLabel: 'Finish',
  },
  COMPLETE: {
    stage: 'COMPLETE',
    title: 'Complete',
    headline: 'Recovered more money using fewer attempts.',
    nextLabel: 'Done',
  },
};

export interface DemoEvent {
  id: string;
  timestamp: number;
  stage: DemoStage;
  type: string;
  message: string;
}

export interface DemoState {
  demoId: string | null;
  stage: DemoStage;
  seed: number;
  datasetVersion: string;
  startedAt: number | null;
  events: DemoEvent[];
}

export const DEMO_SEED = 20260904;
export const DEMO_DATASET_VERSION = 'failures-v1';
/** The activity feed is bounded — a long demo never grows unbounded in memory. */
export const MAX_DEMO_EVENTS = 200;

export function initialDemoState(): DemoState {
  return {
    demoId: null,
    stage: 'READY',
    seed: DEMO_SEED,
    datasetVersion: DEMO_DATASET_VERSION,
    startedAt: null,
    events: [],
  };
}

export function nextStage(stage: DemoStage): DemoStage | null {
  const index = DEMO_STAGES.indexOf(stage);
  if (index < 0 || index === DEMO_STAGES.length - 1) return null;
  return DEMO_STAGES[index + 1] ?? null;
}

export function stageIndex(stage: DemoStage): number {
  return DEMO_STAGES.indexOf(stage);
}
