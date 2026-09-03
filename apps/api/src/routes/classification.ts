import type { FastifyPluginAsync } from 'fastify';
import {
  type ClassifyFailureDeps,
  type StoredClassification,
  classifyFailure,
  liveDeps,
} from '../classification/service';

/**
 * Phase 6 — Deterministic classification.
 *
 *   Payment Failure -> Classification Service -> Rule Evaluation
 *     -> Root Cause + Confidence + Explanation -> Persist -> Audit Event
 *
 * HTTP edge only: resolve the `:failureId` param, call the service, map the
 * tagged result to a status code.
 */
function view(c: StoredClassification) {
  return {
    classificationId: c.id,
    failureId: c.failureId,
    cause: c.cause,
    confidence: c.confidence,
    ruleId: c.ruleId,
    explanation: c.explanation,
    evidence: c.evidence,
    classifierVersion: c.classifierVersion,
    source: c.source,
  };
}

export function createClassificationRoutes(
  deps: ClassifyFailureDeps = liveDeps,
): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Params: { failureId: string } }>(
      '/api/payments/failures/:failureId/classify',
      async (request, reply) => {
        const { failureId } = request.params;
        const result = await classifyFailure(failureId, deps);

        switch (result.status) {
          case 'CLASSIFIED':
            return reply.code(201).send({
              status: 'CLASSIFIED',
              duplicate: false,
              ...view(result.classification),
              candidates: result.result.candidates,
            });
          case 'DUPLICATE':
            return reply.code(200).send({
              status: 'DUPLICATE',
              duplicate: true,
              ...view(result.classification),
            });
          case 'FAILURE_NOT_FOUND':
            return reply.code(404).send({
              status: 'FAILURE_NOT_FOUND',
              error: `No payment failure found with id "${failureId}".`,
              failureId,
            });
        }
      },
    );
  };
}
