import {
  DEMO_STAGE_META,
  createDemoController,
  type DemoController,
} from '@recovery-desk/demo';
import type { FastifyPluginAsync } from 'fastify';
import { getLiveAIClient } from '../ai/deps';
import { evaluationIdFor } from '@recovery-desk/experiment';
import type { EvaluationDeps } from '../evaluations/service';
import {
  DEMO_CONSTANTS,
  type DemoServiceDeps,
  demoCounters,
  demoHealth,
  demoPaymentViews,
  drainRecoveryQueue,
  resetDemo,
  runStageWork,
  startDemo,
} from '../demo/service';

/**
 * Phase 13 §3/§4/§25/§34 — the demo control plane.
 *
 *   POST /api/demo/reset    -> delete only `demo_`-prefixed rows + queue + breaker
 *   POST /api/demo/start    -> load the curated dataset, return the run identity
 *   POST /api/demo/advance  -> move one stage forward AND run that stage's real work
 *   POST /api/demo/drain    -> run one more controlled recovery batch (repeatable)
 *   GET  /api/demo/state    -> stage, bounded event feed, live counters, payments
 *   GET  /api/demo/health   -> presentation pre-flight check
 *
 * There is deliberately no endpoint that forces a circuit state, fakes a
 * recovery, or writes a metric. The demo can only ask the real system to do
 * real work.
 */
export interface DemoRouteDeps {
  controller?: DemoController;
  /** Lets tests assert health without a live evaluation run. */
  evaluationDeps?: EvaluationDeps;
}

export function createDemoRoutes(deps: DemoRouteDeps = {}): FastifyPluginAsync {
  const controller = deps.controller ?? createDemoController();

  return async (app) => {
    const serviceDeps = (): DemoServiceDeps => ({
      controller,
      redis: app.redis,
      aiClient: getLiveAIClient(),
    });

    const evaluationReady = (): boolean => {
      const store = deps.evaluationDeps?.store;
      if (!store) return false;
      return store.has(evaluationIdFor([DEMO_CONSTANTS.seed], 500));
    };

    app.post('/api/demo/reset', async (_request, reply) => {
      const result = await resetDemo(serviceDeps());
      return reply.code(200).send({ status: 'RESET', ...result });
    });

    app.post('/api/demo/start', async (_request, reply) => {
      const identity = await startDemo(serviceDeps());
      return reply.code(201).send(identity);
    });

    app.post('/api/demo/advance', async (_request, reply) => {
      const advance = controller.advance();
      if (!advance.ok) {
        return reply.code(409).send({ status: 'CANNOT_ADVANCE', error: advance.reason, ...advance });
      }

      let detail: Record<string, unknown> = {};
      try {
        detail = (await runStageWork(advance.to, serviceDeps())).detail;
      } catch (err) {
        // §26 — one broken component never bricks the presentation. The stage
        // still advances and the error is surfaced, never silently swallowed.
        const message = err instanceof Error ? err.message : 'stage work failed';
        controller.record('STAGE_ERROR', `${advance.to}: ${message}`);
        detail = { error: message };
      }

      return reply.code(200).send({
        status: 'ADVANCED',
        from: advance.from,
        to: advance.to,
        meta: DEMO_STAGE_META[advance.to],
        detail,
      });
    });

    app.post('/api/demo/drain', async (_request, reply) => {
      const detail = await drainRecoveryQueue(serviceDeps());
      return reply.code(200).send({ status: 'DRAINED', detail });
    });

    app.get('/api/demo/state', async (_request, reply) => {
      const state = controller.getState();
      const [counters, payments] = await Promise.all([demoCounters(), demoPaymentViews()]);
      return reply.code(200).send({
        ...state,
        meta: DEMO_STAGE_META[state.stage],
        stages: Object.values(DEMO_STAGE_META),
        constants: DEMO_CONSTANTS,
        counters,
        payments,
      });
    });

    app.get('/api/demo/health', async (_request, reply) => {
      const health = await demoHealth(serviceDeps(), evaluationReady);
      const configError = controller.verifySeed(DEMO_CONSTANTS.seed, DEMO_CONSTANTS.datasetVersion);
      return reply.code(200).send({ ...health, configError });
    });
  };
}
