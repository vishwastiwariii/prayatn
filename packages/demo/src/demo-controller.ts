import {
  DEMO_DATASET_VERSION,
  DEMO_SEED,
  MAX_DEMO_EVENTS,
  type DemoEvent,
  type DemoStage,
  type DemoState,
  initialDemoState,
  nextStage,
} from './demo-state';

/**
 * Phase 13 §2 — the demo controller.
 *
 * Deliberately dumb and deterministic: it owns stage order and a bounded
 * event log, nothing else. It cannot ingest a failure, open a circuit or
 * call an LLM — apps/api does the real work for a stage and then tells the
 * controller what happened. If this file were deleted mid-demo, the payment
 * system would be entirely unaffected.
 */

export interface DemoConfigError {
  expectedSeed: number;
  expectedDatasetVersion: string;
  actualSeed: number;
  actualDatasetVersion: string;
}

export interface AdvanceResult {
  ok: boolean;
  from: DemoStage;
  to: DemoStage;
  /** Set when `ok` is false. */
  reason?: string;
}

export interface DemoController {
  getState(): DemoState;
  /** Begin a run. Idempotent for the same demoId. */
  start(demoId: string, at?: number): DemoState;
  /** Move exactly one stage forward. Never skips, never loops. */
  advance(at?: number): AdvanceResult;
  /** Append a bounded activity-feed event. */
  record(type: string, message: string, at?: number): DemoEvent;
  /** Back to READY with an empty log (paired with the API's data reset). */
  reset(): DemoState;
  /**
   * Phase 13 §27 — refuse to present against a different dataset than the
   * one the script and the numbers were written for.
   */
  verifySeed(seed: number, datasetVersion: string): DemoConfigError | null;
}

export interface CreateDemoControllerOptions {
  now?: () => number;
  /** Injectable so tests get stable ids. */
  idFactory?: () => string;
}

export function createDemoController(options: CreateDemoControllerOptions = {}): DemoController {
  const now = options.now ?? (() => Date.now());
  let counter = 0;
  const idFactory = options.idFactory ?? (() => `evt_${(counter += 1).toString().padStart(4, '0')}`);

  let state: DemoState = initialDemoState();

  function record(type: string, message: string, at: number = now()): DemoEvent {
    const event: DemoEvent = {
      id: idFactory(),
      timestamp: at,
      stage: state.stage,
      type,
      message,
    };
    // Bounded: a long-running demo never grows unbounded (Phase 13 §29).
    const events = [...state.events, event];
    state = {
      ...state,
      events: events.length > MAX_DEMO_EVENTS ? events.slice(-MAX_DEMO_EVENTS) : events,
    };
    return event;
  }

  return {
    getState: () => state,

    start(demoId, at = now()) {
      if (state.demoId === demoId) return state;
      state = { ...initialDemoState(), demoId, startedAt: at };
      record('DEMO_STARTED', `Demo ${demoId} started on seed ${DEMO_SEED} (${DEMO_DATASET_VERSION}).`, at);
      return state;
    },

    advance(at = now()) {
      const from = state.stage;
      if (!state.demoId) {
        return { ok: false, from, to: from, reason: 'Demo has not been started.' };
      }
      const to = nextStage(from);
      if (!to) {
        return { ok: false, from, to: from, reason: 'Demo is already complete.' };
      }
      state = { ...state, stage: to };
      record('STAGE_ADVANCED', `${from} -> ${to}`, at);
      return { ok: true, from, to };
    },

    record,

    reset() {
      counter = 0;
      state = initialDemoState();
      return state;
    },

    verifySeed(seed, datasetVersion) {
      if (seed === DEMO_SEED && datasetVersion === DEMO_DATASET_VERSION) return null;
      return {
        expectedSeed: DEMO_SEED,
        expectedDatasetVersion: DEMO_DATASET_VERSION,
        actualSeed: seed,
        actualDatasetVersion: datasetVersion,
      };
    },
  };
}
