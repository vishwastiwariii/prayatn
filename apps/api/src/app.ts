import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Env, describeEnv, loadEnv } from './env';
import { type AIRouteDeps, createAIRoutes } from './routes/ai';
import type { ClassifyFailureDeps } from './classification/service';
import authPlugin from './plugins/auth';
import errorHandlerPlugin from './plugins/error-handler';
import observabilityPlugin from './plugins/observability';
import prismaPlugin from './plugins/prisma';
import redisPlugin from './plugins/redis';
import securityPlugin from './plugins/security';
import { type EvaluationDeps, createLiveEvaluationDeps } from './evaluations/service';
import { createClassificationRoutes } from './routes/classification';
import { type DashboardRouteDeps, createDashboardRoutes } from './routes/dashboard';
import { type DemoRouteDeps, createDemoRoutes } from './routes/demo';
import { createEvaluationRoutes } from './routes/evaluations';
import { failureRoutes } from './routes/failures';
import { type GatewayRouteDeps, createGatewayRoutes } from './routes/gateway';
import { healthRoutes } from './routes/health';
import { type HumanReviewRouteDeps, createHumanReviewRoutes } from './routes/human-review';
import { type PaymentsRouteDeps, createPaymentsRoutes } from './routes/payments';
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
  /** Override the gateway circuit breaker (used by tests). */
  gatewayDeps?: GatewayRouteDeps;
  /** Override the dashboard aggregation reader (used by tests). */
  dashboardDeps?: DashboardRouteDeps;
  /** Override the payments read service (used by tests). */
  paymentsDeps?: PaymentsRouteDeps;
  /** Override the human review service (used by tests). */
  humanReviewDeps?: HumanReviewRouteDeps;
  /** Override the AI client (used by tests — pass `{ client: null }` to force fallback paths). */
  aiDeps?: AIRouteDeps;
  /** Override the demo controller (used by tests). */
  demoDeps?: DemoRouteDeps;
}

export async function buildApp(
  env: Env = loadEnv(),
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    // Phase 14 §1 — cap request bodies before Fastify reads them.
    bodyLimit: env.MAX_BODY_BYTES,
    // Trust the reverse proxy for client IPs (rate limiting) in production only.
    trustProxy: env.NODE_ENV === 'production',
    // Phase 14 §8 — the correlation id IS Fastify's request id, so every log
    // line the framework already emits for a request carries it as `reqId`,
    // and an inbound `x-request-id` from a proxy is preserved end to end.
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      return typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 128
        ? inbound
        : randomUUID();
    },
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

  // Order matters: context and error shape first, then transport hardening,
  // then auth, then anything that touches data.
  await app.register(observabilityPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });
  await app.register(authPlugin);
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(healthRoutes);
  await app.register(failureRoutes);
  await app.register(createClassificationRoutes(options.classificationDeps));
  await app.register(createRecoveryRoutes(options.recoveryDeps));
  // One evaluation store, shared by the evaluation routes and the demo's
  // health check so "has the experiment been run yet?" has a single answer.
  const evaluationDeps = options.evaluationDeps ?? createLiveEvaluationDeps();
  await app.register(createEvaluationRoutes(evaluationDeps));
  await app.register(createGatewayRoutes(options.gatewayDeps));
  await app.register(createDashboardRoutes(options.dashboardDeps));
  await app.register(createPaymentsRoutes(options.paymentsDeps));
  await app.register(createHumanReviewRoutes(options.humanReviewDeps));
  await app.register(createAIRoutes(options.aiDeps));
  await app.register(createDemoRoutes({ evaluationDeps, ...options.demoDeps }));

  app.log.info({ event: 'api.configured', config: describeEnv(env) }, 'API configured');

  return app;
}
