import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type PaymentsReader, livePaymentsReader } from '../payments/service';

/**
 * Phase 11 §13/§14 — the Payment Explorer and Payment Detail screens' HTTP
 * edge. Human review moved to `routes/human-review.ts` in Phase 12.
 *
 *   GET  /api/payments               -> paginated list + filters
 *   GET  /api/payments/:paymentId     -> full detail + audit timeline
 */
export interface PaymentsRouteDeps {
  reader?: PaymentsReader;
}

const listQuerySchema = z.object({
  status: z
    .enum(['FAILED', 'CLASSIFIED', 'SCHEDULED', 'RETRYING', 'RECOVERED', 'HARD_STOPPED', 'EXHAUSTED', 'HUMAN_REVIEW'])
    .optional(),
  cause: z
    .enum([
      'CUSTOMER_FUNDS_LOW',
      'CUSTOMER_AUTH_FAILURE',
      'CUSTOMER_ABANDONMENT',
      'ISSUER_TEMPORARY_FAILURE',
      'GATEWAY_FAILURE',
      'PAYMENT_METHOD_INVALID',
      'MANDATE_INVALID',
      'UNKNOWN',
    ])
    .optional(),
  method: z.enum(['CARD', 'UPI', 'NETBANKING', 'WALLET', 'MANDATE']).optional(),
  action: z.enum(['RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE', 'HARD_STOP', 'HUMAN_REVIEW']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function createPaymentsRoutes(deps: PaymentsRouteDeps = {}): FastifyPluginAsync {
  const reader = deps.reader ?? livePaymentsReader;

  return async (app) => {
    app.get('/api/payments', async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          status: 'INVALID',
          error: 'Invalid query parameters.',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const result = await reader.list(parsed.data);
      return reply.code(200).send(result);
    });

    app.get<{ Params: { paymentId: string } }>(
      '/api/payments/:paymentId',
      async (request, reply) => {
        const detail = await reader.detail(request.params.paymentId);
        if (!detail) {
          return reply.code(404).send({
            status: 'NOT_FOUND',
            error: `No payment "${request.params.paymentId}".`,
          });
        }
        return reply.code(200).send(detail);
      },
    );
  };
}
