/**
 * `@recovery-desk/demo` — Phase 13's deterministic presentation layer.
 *
 * Pure: stage order, the curated 12-payment dataset, and a bounded event log.
 * All real behaviour (ingestion, classification, policy, queue, circuit
 * breaker, AI) stays in the existing packages — the demo only sequences it.
 */
export {
  DEMO_STAGES,
  DEMO_STAGE_META,
  DEMO_SEED,
  DEMO_DATASET_VERSION,
  MAX_DEMO_EVENTS,
  initialDemoState,
  nextStage,
  stageIndex,
} from './demo-state';
export type { DemoStage, DemoStageMeta, DemoEvent, DemoState } from './demo-state';

export {
  DEMO_ID_PREFIX,
  DEMO_CUSTOMERS,
  DEMO_PAYMENTS,
  DEMO_AMOUNT_AT_RISK_MINOR,
  DEMO_AI_MESSAGE_PAYMENT_ID,
  DEMO_UNKNOWN_PAYMENT_ID,
  DEMO_TRACE_PAYMENT_ID,
  demoCauseDistribution,
} from './demo-scenarios';
export type { DemoCustomer, DemoPayment } from './demo-scenarios';

export { createDemoController } from './demo-controller';
export type {
  DemoController,
  CreateDemoControllerOptions,
  AdvanceResult,
  DemoConfigError,
} from './demo-controller';
