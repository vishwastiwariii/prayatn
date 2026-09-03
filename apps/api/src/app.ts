import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Env, loadEnv } from './env';
import type { ClassifyFailureDeps } from './classification/service';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import type { EvaluationDeps } from './evaluations/service';
import { createClassificationRoutes } from './routes/classification';
import { createEvaluationRoutes } from './routes/evaluations';
import { failureRoutes } from './routes/failures';
import { healthRoutes } from './routes/health';
import { type RecoveryRouteDeps, createRecoveryRoutes } from './routes/recovery';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}

export interface BuildAppOptions {
  /** Override the classification pipeline's data access (used by tests). */
  classificationDeps?: ClassifyFailureDeps;
  /** Override the recovery decide/enqueue data access (used by tests). */
  recoveryDeps?: RecoveryRouteDeps;
  /** Override the evaluation runner + store (used by tests). */
  evaluationDeps?: EvaluationDeps;
}

export async function buildApp(
  env: Env = loadEnv(),
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
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
  await app.register(failureRoutes);
  await app.register(createClassificationRoutes(options.classificationDeps));
  await app.register(createRecoveryRoutes(options.recoveryDeps));
  await app.register(createEvaluationRoutes(options.evaluationDeps));

  return app;
}
