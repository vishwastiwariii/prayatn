import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (app) => {
  const redis = new Redis(app.env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });

  redis.on('error', (err) => {
    app.log.error({ err }, 'redis connection error');
  });

  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    redis.disconnect();
  });
};

export default fp(redisPlugin, { name: 'redis' });
