import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  closeLiveCircuitBreaker,
  closeRecoveryQueue,
  createRecoveryWorker,
  executeRecoveryAction,
  liveExecuteDeps,
  makeRecoveryProcessor,
} from '@recovery-desk/recovery';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Recovery worker process (Phase 9, hardened in Phase 14 §3/§11).
 *
 * Pulls jobs off the BullMQ `recovery-actions` queue and runs
 * `executeRecoveryAction` — which executes the ALREADY-APPROVED action, records
 * the outcome, updates the payment and writes the audit event.
 *
 * A gateway decline is a normal completed job. Only infrastructure faults throw,
 * and BullMQ's job-level retry handles those.
 *
 * The distinction that matters:
 *
 *   BullMQ retry  ≠  payment retry
 *
 * A crash between charging the gateway and writing the outcome WILL redeliver
 * the job. That is safe because `executeRecoveryAction` checks for an existing
 * outcome first (`outcomeExists`) and the action row carries a unique
 * idempotency key — a redelivered job returns DUPLICATE and makes zero gateway
 * calls. Whether the payment is tried again is a policy decision, made
 * elsewhere, never an infrastructure side effect.
 */
const SHUTDOWN_TIMEOUT_MS = 30_000;

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
}

function main(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // FAIL FAST — a worker with no queue is a silent no-op, which is worse
    // than a crash: payments would sit queued forever with nobody consuming.
    process.stderr.write('[recovery-worker] REDIS_URL is required\n');
    process.exit(1);
  }
  const concurrency = Number(process.env.RECOVERY_WORKER_CONCURRENCY ?? 4);

  const worker = createRecoveryWorker(
    redisUrl,
    makeRecoveryProcessor((actionId) => executeRecoveryAction(actionId, liveExecuteDeps)),
    { concurrency },
  );

  worker.on('ready', () => log('worker.ready', { queue: 'recovery-actions', concurrency }));
  worker.on('completed', (job, result) =>
    log('worker.job_completed', {
      jobId: job.id,
      actionId: job.data.actionId,
      paymentId: job.data.paymentId,
      result,
    }),
  );
  worker.on('failed', (job, err) =>
    log('worker.job_failed', {
      jobId: job?.id,
      actionId: job?.data?.actionId,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    }),
  );
  // A stalled job is one whose worker died mid-execution. BullMQ re-queues it;
  // idempotency is what makes that safe. Log it so it is never invisible.
  worker.on('stalled', (jobId) => log('worker.job_stalled', { jobId }));
  worker.on('error', (err) => log('worker.error', { error: err.message }));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      log('shutdown.duplicate_signal', { signal });
      return;
    }
    shuttingDown = true;
    log('shutdown.started', { signal });

    const forced = setTimeout(() => {
      log('shutdown.timeout', { afterMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    // `worker.close()` stops fetching NEW jobs and waits for the in-flight one
    // to finish — never abandoning a job halfway through a payment side effect.
    worker
      .close()
      .then(() => closeRecoveryQueue())
      .then(() => closeLiveCircuitBreaker())
      .then(() => {
        log('shutdown.complete', { signal });
        clearTimeout(forced);
        process.exit(0);
      })
      .catch((err) => {
        log('shutdown.failed', { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      });
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => shutdown(sig));
  }

  process.on('unhandledRejection', (reason) => {
    log('process.unhandled_rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main();
