import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  closeRecoveryQueue,
  createRecoveryWorker,
  executeRecoveryAction,
  liveExecuteDeps,
} from '@recovery-desk/recovery';

loadDotenv({ path: resolve(process.cwd(), '.env') });
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

/**
 * Recovery worker process (Phase 9).
 *
 * Pulls jobs off the BullMQ `recovery-actions` queue and runs
 * `executeRecoveryAction` — which executes the ALREADY-APPROVED action, records
 * the outcome, updates the payment and writes the audit event.
 *
 * A gateway decline is a normal completed job. Only infrastructure faults throw,
 * and BullMQ's job-level retry (attempts + exponential backoff) handles those.
 */
function main(): void {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6389';
  const concurrency = Number(process.env.RECOVERY_WORKER_CONCURRENCY ?? 4);

  const worker = createRecoveryWorker(
    redisUrl,
    async (job) => executeRecoveryAction(job.data.actionId, liveExecuteDeps),
    { concurrency },
  );

  worker.on('ready', () => {
    process.stdout.write(
      `[recovery-worker] listening on "recovery-actions" (concurrency ${concurrency})\n`,
    );
  });
  worker.on('completed', (job, result) => {
    process.stdout.write(`[recovery-worker] job ${job.id} -> ${JSON.stringify(result)}\n`);
  });
  worker.on('failed', (job, err) => {
    process.stderr.write(
      `[recovery-worker] job ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade}): ${err.message}\n`,
    );
  });
  worker.on('error', (err) => {
    process.stderr.write(`[recovery-worker] worker error: ${err.message}\n`);
  });

  const shutdown = (signal: string): void => {
    process.stdout.write(`[recovery-worker] ${signal} received, closing...\n`);
    worker
      .close()
      .then(() => closeRecoveryQueue())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => shutdown(sig));
  }
}

main();
