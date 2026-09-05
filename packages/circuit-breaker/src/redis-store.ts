import type { Redis } from 'ioredis';
import { PROBE_LOCK_TTL_SECONDS } from './config';
import { EMPTY_GATEWAY_METRICS } from './types';
import type { CircuitSnapshot, CircuitStateStore, GatewayReliabilityMetrics } from './types';

/**
 * Redis-backed `CircuitStateStore` — the production implementation.
 *
 * State is SHARED across every API process and every recovery worker. All
 * mutating operations are atomic (single Lua script or a native atomic command),
 * so two workers observing the threshold at the same instant cannot produce an
 * inconsistent circuit, and only one worker can ever hold the HALF_OPEN probe.
 *
 * The pure state machine (`state-machine.ts`) never imports this file.
 */

export interface RedisCircuitStoreOptions {
  redis: Redis;
  keyPrefix?: string;
  failureWindowSeconds: number;
  probeLockTtlSeconds?: number;
  now?: () => number;
}

const GET_STATE = `
local state = redis.call('GET', KEYS[1]) or 'CLOSED'
local openedAt = redis.call('GET', KEYS[2])
local reason = redis.call('GET', KEYS[3])
redis.call('ZREMRANGEBYSCORE', KEYS[4], 0, tonumber(ARGV[1]))
local failures = redis.call('ZCARD', KEYS[4])
local probe = redis.call('EXISTS', KEYS[5])
return { state, openedAt or '', reason or '', failures, probe }
`;

const RECORD_FAILURE = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. ':' .. ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
`;

const ENTER_HALF_OPEN = `
if redis.call('GET', KEYS[1]) == 'OPEN' then
  redis.call('SET', KEYS[1], 'HALF_OPEN')
  return 1
end
return 0
`;

const OPEN_CIRCUIT = `
if redis.call('GET', KEYS[1]) ~= 'OPEN' then
  redis.call('SET', KEYS[1], 'OPEN')
  redis.call('SET', KEYS[2], ARGV[1])
  redis.call('SET', KEYS[3], ARGV[2])
  redis.call('DEL', KEYS[4])
  return 1
end
return 0
`;

const CLOSE_CIRCUIT = `
local was = redis.call('GET', KEYS[1])
redis.call('SET', KEYS[1], 'CLOSED')
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
if was and was ~= 'CLOSED' then return 1 end
return 0
`;

const RELEASE_PROBE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
`;

export function createRedisCircuitStore(opts: RedisCircuitStoreOptions): CircuitStateStore {
  const { redis } = opts;
  const p = opts.keyPrefix ?? 'circuit:gateway';
  const now = opts.now ?? (() => Date.now());
  const windowMs = opts.failureWindowSeconds * 1000;
  const probeTtlMs = (opts.probeLockTtlSeconds ?? PROBE_LOCK_TTL_SECONDS) * 1000;

  const K = {
    state: `${p}:state`,
    openedAt: `${p}:opened-at`,
    reason: `${p}:reason`,
    failures: `${p}:failures`,
    probe: `${p}:probe-lock`,
    blockedSeq: `${p}:blocked-seq`,
    metrics: `${p}:metrics`,
  };

  let failMember = 0;

  return {
    async getState(): Promise<CircuitSnapshot> {
      const cutoff = now() - windowMs;
      const res = (await redis.eval(
        GET_STATE,
        5,
        K.state,
        K.openedAt,
        K.reason,
        K.failures,
        K.probe,
        String(cutoff),
      )) as [string, string, string, number, number];
      const [state, openedAt, reason, failureCount, probe] = res;
      return {
        state: (state as CircuitSnapshot['state']) || 'CLOSED',
        failureCount: Number(failureCount) || 0,
        openedAt: openedAt ? Number(openedAt) : null,
        reason: reason || null,
        probeInProgress: Number(probe) === 1,
      };
    },

    async recordFailure(timestampMs) {
      failMember += 1;
      await redis.eval(
        RECORD_FAILURE,
        1,
        K.failures,
        String(timestampMs),
        `${failMember}`,
        String(timestampMs - windowMs),
        String(opts.failureWindowSeconds * 3),
      );
    },

    async recordSuccess() {
      await redis.del(K.failures);
    },

    async enterHalfOpen() {
      const changed = (await redis.eval(ENTER_HALF_OPEN, 1, K.state)) as number;
      return { changed: changed === 1 };
    },

    async tryAcquireProbe(token) {
      const ok = await redis.set(K.probe, token, 'PX', probeTtlMs, 'NX');
      return ok === 'OK';
    },

    async releaseProbe(token) {
      await redis.eval(RELEASE_PROBE, 1, K.probe, token);
    },

    async open(reason, atMs) {
      const changed = (await redis.eval(
        OPEN_CIRCUIT,
        4,
        K.state,
        K.openedAt,
        K.reason,
        K.probe,
        String(atMs),
        reason,
      )) as number;
      return { changed: changed === 1 };
    },

    async close() {
      const changed = (await redis.eval(
        CLOSE_CIRCUIT,
        6,
        K.state,
        K.openedAt,
        K.reason,
        K.failures,
        K.probe,
        K.blockedSeq,
      )) as number;
      return { changed: changed === 1 };
    },

    async nextBlockedSlot() {
      const n = await redis.incr(K.blockedSeq);
      await redis.expire(K.blockedSeq, opts.failureWindowSeconds * 4);
      return n - 1;
    },

    async incrementMetric(name, by = 1) {
      await redis.hincrby(K.metrics, name, by);
    },

    async readMetrics(): Promise<GatewayReliabilityMetrics> {
      const raw = await redis.hgetall(K.metrics);
      const out = { ...EMPTY_GATEWAY_METRICS };
      for (const key of Object.keys(out) as (keyof GatewayReliabilityMetrics)[]) {
        if (raw[key] != null) out[key] = Number(raw[key]) || 0;
      }
      return out;
    },

    async reset() {
      await redis.del(K.state, K.openedAt, K.reason, K.failures, K.probe, K.blockedSeq, K.metrics);
    },
  };
}
