import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SERVICE_NAME } from '@recovery-desk/shared';
import { getRecoveryQueue } from '@recovery-desk/recovery';
import { describeEnv } from '../env';

type DependencyStatus = 'ok' | 'error';

/**
 * Phase 14 §9 — liveness and readiness are different questions.
 *
 *   /health/live   Is this process alive? Never touches a dependency, so a
 *                  database blip cannot get the container killed and restarted
 *                  into the same blip.
 *   /health/ready  Should this instance receive traffic? Checks Postgres,
 *                  Redis and the queue, and 503s if any is unavailable.
 *
 * `/health` stays as the simple human/demo check it has always been.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return { status: 'ok', service: SERVICE_NAME };
  });

  app.get('/health/live', async () => {
    return { status: 'ok', service: SERVICE_NAME, uptimeSeconds: Math.round(process.uptime()) };
  });

  app.get('/health/ready', async (_request, reply) => {
    const [postgres, redis, queue] = await Promise.all([
      checkPostgres(app),
      checkRedis(app),
      checkQueue(),
    ]);
    const ready = postgres === 'ok' && redis === 'ok' && queue === 'ok';

    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      service: SERVICE_NAME,
      dependencies: { postgres, redis, queue },
      config: describeEnv(app.env),
    };
  });

  app.get('/health/dependencies', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([checkPostgres(app), checkRedis(app)]);
    const healthy = postgres === 'ok' && redis === 'ok';

    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? 'ok' : 'degraded',
      dependencies: { postgres, redis },
    };
  });
};

async function checkPostgres(app: FastifyInstance): Promise<DependencyStatus> {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (err) {
    app.log.error({ event: 'health.postgres_failed', err }, 'postgres health check failed');
    return 'error';
  }
}

async function checkRedis(app: FastifyInstance): Promise<DependencyStatus> {
  try {
    const pong = await app.redis.ping();
    return pong === 'PONG' ? 'ok' : 'error';
  } catch (err) {
    app.log.error({ event: 'health.redis_failed', err }, 'redis health check failed');
    return 'error';
  }
}

async function checkQueue(): Promise<DependencyStatus> {
  try {
    await getRecoveryQueue().getJobCounts();
    return 'ok';
  } catch {
    return 'error';
  }
}
