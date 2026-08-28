import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SERVICE_NAME } from '@recovery-desk/shared';

type DependencyStatus = 'ok' | 'error';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return { status: 'ok', service: SERVICE_NAME };
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
    app.log.error({ err }, 'postgres health check failed');
    return 'error';
  }
}

async function checkRedis(app: FastifyInstance): Promise<DependencyStatus> {
  try {
    const pong = await app.redis.ping();
    return pong === 'PONG' ? 'ok' : 'error';
  } catch (err) {
    app.log.error({ err }, 'redis health check failed');
    return 'error';
  }
}
