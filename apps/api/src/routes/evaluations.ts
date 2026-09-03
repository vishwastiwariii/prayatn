import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  type EvaluationDeps,
  createLiveEvaluationDeps,
  getEvaluation,
  startEvaluation,
} from '../evaluations/service';

/**
 * Phase 9 — the experiment / comparison engine's HTTP edge.
 *
 *   POST /api/evaluations              -> { evaluationId, status: "COMPLETED" }
 *   GET  /api/evaluations/:evaluationId -> the full comparison summary
 *
 * Body (all optional):
 *   { "seeds": [20260904, 20260905], "count": 500 }   multi-seed
 *   { "seed": 20260904, "count": 500 }                single-seed
 *   {}                                                defaults (seed 20260904, 500)
 */
const bodySchema = z
  .object({
    seed: z.number().int().optional(),
    seeds: z.array(z.number().int()).min(1).max(25).optional(),
    count: z.number().int().min(10).max(5000).optional(),
  })
  .strict();

export function createEvaluationRoutes(
  deps: EvaluationDeps = createLiveEvaluationDeps(),
): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/evaluations', async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          status: 'INVALID',
          error: 'Invalid evaluation request.',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      let result;
      try {
        result = startEvaluation(parsed.data, deps);
      } catch (err) {
        return reply.code(400).send({
          status: 'INVALID',
          error: err instanceof Error ? err.message : 'evaluation failed',
        });
      }

      return reply
        .code(result.created ? 201 : 200)
        .send({ evaluationId: result.evaluationId, status: result.status });
    });

    app.get<{ Params: { evaluationId: string } }>(
      '/api/evaluations/:evaluationId',
      async (request, reply) => {
        const { evaluationId } = request.params;
        const summary = getEvaluation(evaluationId, deps);
        if (!summary) {
          return reply
            .code(404)
            .send({ status: 'NOT_FOUND', error: `No evaluation "${evaluationId}".`, evaluationId });
        }
        return reply.code(200).send(summary);
      },
    );
  };
}
