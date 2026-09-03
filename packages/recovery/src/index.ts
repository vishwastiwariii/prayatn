/**
 * `@recovery-desk/recovery` — the asynchronous recovery pipeline.
 *
 *   POST /decide   -> decideRecovery()        persists ONE approved RecoveryAction
 *   POST /enqueue  -> enqueueRecoveryAction() puts it on the BullMQ queue
 *   worker         -> executeRecoveryAction() runs the APPROVED action, records
 *                                             the outcome, updates the payment,
 *                                             writes the audit event
 *
 * The worker never classifies and never runs the policy engine. It executes
 * what `/decide` already approved, after a conservative safety re-check.
 */
export {
  RECOVERY_QUEUE_NAME,
  INFRA_RETRY_OPTIONS,
  InfrastructureError,
  parseRedisConnection,
  createRecoveryQueue,
  enqueueRecoveryJob,
  createRecoveryWorker,
} from './queue';
export type { RecoveryJobData, RecoveryJobResult, Job } from './queue';

export { decideRecovery, DECISION_IDEMPOTENCY_PREFIX } from './decide-service';
export { enqueueRecoveryAction } from './enqueue-service';
export type { EnqueueOptions } from './enqueue-service';
export { executeRecoveryAction } from './execute-service';

export {
  liveDecideDeps,
  liveEnqueueDeps,
  liveExecuteDeps,
  getRecoveryQueue,
  closeRecoveryQueue,
} from './live-deps';

export * from './types';
