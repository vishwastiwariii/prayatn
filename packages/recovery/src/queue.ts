import {
  DelayedError,
  type Job,
  type JobsOptions,
  Queue,
  type RedisOptions,
  Worker,
} from 'bullmq';

/**
 * BullMQ wiring for the recovery pipeline.
 *
 *   API  ──enqueueRecoveryJob()──▶  Redis (BullMQ)  ──▶  createRecoveryWorker()
 *
 * The retry settings here are for INFRASTRUCTURE failures only (Redis blip, DB
 * connection drop, an unexpected throw). A payment the gateway declines is NOT
 * an error: the worker records a RecoveryOutcome and the job COMPLETES. Whether
 * to try that payment again is a policy decision made elsewhere — never a
 * BullMQ retry.
 */

export const RECOVERY_QUEUE_NAME = 'recovery-actions';

export interface RecoveryJobData {
  actionId: string;
  paymentId: string;
  attemptNumber: number;
  enqueuedAt: string;
}

export interface RecoveryJobResult {
  status: string;
  outcomeId?: string;
  paymentStatus?: string;
}

/**
 * Infra-only retry policy applied to every job. Exponential backoff so a
 * transient Redis/DB outage is ridden out; capped attempts so a genuinely
 * broken job eventually lands in `failed` for an operator, not an infinite loop.
 */
export const INFRA_RETRY_OPTIONS: Pick<JobsOptions, 'attempts' | 'backoff'> = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 2000 },
};

/** Thrown by a processor to signal "this was infra, retry me". Anything else
 * thrown is treated the same way by BullMQ, but this makes intent explicit. */
export class InfrastructureError extends Error {
  override readonly name = 'InfrastructureError';
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function parseRedisConnection(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.pathname && u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
  };
}

/**
 * `queueName` exists so an integration test can run on its own namespace. Two
 * consumers on the same queue steal each other's jobs — which is correct BullMQ
 * behaviour, and exactly what made this suite flaky whenever a dev worker was
 * running. Production always uses the default.
 */
export function createRecoveryQueue(
  redisUrl: string,
  queueName: string = RECOVERY_QUEUE_NAME,
): Queue<RecoveryJobData, RecoveryJobResult> {
  return new Queue<RecoveryJobData, RecoveryJobResult>(queueName, {
    connection: parseRedisConnection(redisUrl),
    defaultJobOptions: {
      ...INFRA_RETRY_OPTIONS,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: false,
    },
  });
}

/**
 * Enqueue one already-persisted RecoveryAction. `jobId` is the action id, so a
 * repeat enqueue of the same action is a no-op at the Redis level.
 */
export async function enqueueRecoveryJob(
  queue: Queue<RecoveryJobData, RecoveryJobResult>,
  data: RecoveryJobData,
  opts: { delayMs?: number } = {},
): Promise<{ jobId: string; delayMs: number }> {
  const delayMs = Math.max(0, Math.trunc(opts.delayMs ?? 0));
  await queue.add('execute-recovery-action', data, {
    jobId: data.actionId,
    delay: delayMs,
    ...INFRA_RETRY_OPTIONS,
  });
  return { jobId: data.actionId, delayMs };
}

export function createRecoveryWorker(
  redisUrl: string,
  processor: (
    job: Job<RecoveryJobData, RecoveryJobResult>,
    token?: string,
  ) => Promise<RecoveryJobResult>,
  opts: { concurrency?: number; autorun?: boolean; queueName?: string } = {},
): Worker<RecoveryJobData, RecoveryJobResult> {
  return new Worker<RecoveryJobData, RecoveryJobResult>(opts.queueName ?? RECOVERY_QUEUE_NAME, processor, {
    connection: { ...parseRedisConnection(redisUrl), maxRetriesPerRequest: null },
    concurrency: opts.concurrency ?? 4,
    autorun: opts.autorun ?? true,
  });
}

/** Shape returned by the execute-service for a circuit-blocked action. */
export interface CircuitBlockedResult {
  status: 'CIRCUIT_BLOCKED';
  retryAfterSeconds: number;
  trigger?: string;
  circuitState?: string;
}

function isCircuitBlocked(
  res: RecoveryJobResult | CircuitBlockedResult,
): res is CircuitBlockedResult {
  return res.status === 'CIRCUIT_BLOCKED';
}

/**
 * Wrap `executeRecoveryAction` into a BullMQ processor.
 *
 * When the action is circuit-blocked, the SAME job is pushed into the future via
 * `job.moveToDelayed` + `DelayedError` — never `sleep`, never a BullMQ auto-retry
 * counting against `attempts`, and never a new job (so no double-charge risk).
 */
export function makeRecoveryProcessor(
  run: (actionId: string) => Promise<RecoveryJobResult | CircuitBlockedResult>,
  now: () => number = () => Date.now(),
): (job: Job<RecoveryJobData, RecoveryJobResult>, token?: string) => Promise<RecoveryJobResult> {
  return async (job, token) => {
    const res = await run(job.data.actionId);
    if (isCircuitBlocked(res)) {
      const retryAfterSeconds = Math.max(1, Number(res.retryAfterSeconds ?? 30));
      await job.moveToDelayed(now() + retryAfterSeconds * 1000, token);
      throw new DelayedError();
    }
    return res;
  };
}

export { DelayedError };
export type { Job } from 'bullmq';
