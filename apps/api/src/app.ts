import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Env, loadEnv } from './env';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import { healthRoutes } from './routes/health';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}

export async function buildApp(env: Env = loadEnv()): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    logger:
      env.LOG_LEVEL === 'silent'
        ? false
        : {
            level: env.LOG_LEVEL,
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                },
          },
  });

  app.decorate('env', env);

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  });
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(healthRoutes);

  return app;
}
