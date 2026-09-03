/**
 * In-memory test doubles for the recovery pipeline, shared across the repo's
 * test suites (`@recovery-desk/recovery/testing`). Not used in production code.
 */
export { makeWorld, seedFailure, decideDepsFor, enqueueDepsFor, executeDepsFor } from './_fakes';
export type {
  World,
  PaymentRow,
  FailureRow,
  ClassificationRow,
  ActionRow,
  OutcomeRow,
  AuditRow,
} from './_fakes';
