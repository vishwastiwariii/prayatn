import { describe, expect, it, vi } from 'vitest';
import {
  INFRA_RETRY_OPTIONS,
  RECOVERY_QUEUE_NAME,
  enqueueRecoveryJob,
  parseRedisConnection,
} from './queue';

describe('parseRedisConnection', () => {
  it('parses host/port', () => {
    expect(parseRedisConnection('redis://localhost:6389')).toMatchObject({
      host: 'localhost',
      port: 6389,
    });
  });
  it('parses auth + db index', () => {
    expect(parseRedisConnection('redis://user:pass@10.0.0.1:6380/3')).toMatchObject({
      host: '10.0.0.1',
      port: 6380,
      username: 'user',
      password: 'pass',
      db: 3,
    });
  });
});

describe('INFRA_RETRY_OPTIONS', () => {
  it('is exponential backoff with a small capped attempt count (infra, not policy)', () => {
    expect(INFRA_RETRY_OPTIONS.attempts).toBe(4);
    expect(INFRA_RETRY_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 2000 });
  });
});

describe('enqueueRecoveryJob', () => {
  it('adds one job keyed by actionId, with the delay and infra-retry options', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Parameters<typeof enqueueRecoveryJob>[0];
    const data = { actionId: 'act_1', paymentId: 'pay_1', attemptNumber: 2, enqueuedAt: 'now' };

    const r = await enqueueRecoveryJob(queue, data, { delayMs: 18 * 60_000 });

    expect(r).toEqual({ jobId: 'act_1', delayMs: 18 * 60_000 });
    expect(add).toHaveBeenCalledWith(
      'execute-recovery-action',
      data,
      expect.objectContaining({ jobId: 'act_1', delay: 18 * 60_000, attempts: 4 }),
    );
  });

  it('clamps a negative delay to 0', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Parameters<typeof enqueueRecoveryJob>[0];
    const r = await enqueueRecoveryJob(
      queue,
      { actionId: 'a', paymentId: 'p', attemptNumber: 1, enqueuedAt: 'x' },
      { delayMs: -5000 },
    );
    expect(r.delayMs).toBe(0);
  });
});

describe('queue name', () => {
  it('is the documented name', () => {
    expect(RECOVERY_QUEUE_NAME).toBe('recovery-actions');
  });
});
