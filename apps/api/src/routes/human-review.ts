import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type HumanReviewService, liveHumanReviewService } from '../human-review/service';

/**
 * Phase 12 §18 — the human review queue's HTTP edge.
 *
 *   GET  /api/human-review                 -> pending reviews (recoveryStatus=HUMAN_REVIEW)
 *   POST /api/human-review/:failureId/resolve -> ACCEPT / REJECT / KEEP_UNKNOWN
 */
export interface HumanReviewRouteDeps {
  service?: HumanReviewService;
}

const rootCauseEnum = z.enum([
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
]);

const resolveBodySchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT', 'KEEP_UNKNOWN']),
  rootCause: rootCauseEnum.optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export function createHumanReviewRoutes(deps: HumanReviewRouteDeps = {}): FastifyPluginAsync {
  const service = deps.service ?? liveHumanReviewService;

  return async (app) => {
    app.get('/api/human-review', async (_request, reply) => {
      const items = await service.listPending();
      return reply.code(200).send({ total: items.length, items });
    });

    app.post<{ Params: { failureId: string } }>(
      '/api/human-review/:failureId/resolve',
      async (request, reply) => {
        const parsed = resolveBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            status: 'INVALID',
            error: 'Invalid human review resolution.',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          });
        }

        const { failureId } = request.params;
        const result = await service.resolve({ failureId, ...parsed.data });

        switch (result.status) {
          case 'RESOLVED':
            return reply.code(201).send({
              status: 'RESOLVED',
              duplicate: false,
              classificationId: result.classificationId,
              cause: result.cause,
            });
          case 'DUPLICATE':
            return reply.code(200).send({
              status: 'DUPLICATE',
              duplicate: true,
              classificationId: result.classificationId,
              cause: result.cause,
            });
          case 'FAILURE_NOT_FOUND':
            return reply
              .code(404)
              .send({ status: 'FAILURE_NOT_FOUND', error: `No payment failure "${failureId}".` });
          case 'NOT_CLASSIFIED':
            return reply.code(409).send({
              status: 'NOT_CLASSIFIED',
              error: `Failure "${failureId}" has no classification yet.`,
            });
          case 'ROOT_CAUSE_REQUIRED':
            return reply.code(400).send({
              status: 'ROOT_CAUSE_REQUIRED',
              error: 'A "rootCause" is required for ACCEPT and REJECT decisions.',
            });
        }
      },
    );
  };
}
