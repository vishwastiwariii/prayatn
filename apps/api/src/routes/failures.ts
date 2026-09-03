import type { FastifyPluginAsync } from 'fastify';
import { normalizeFailure } from '../ingestion/normalize';
import { parseFailurePayload, parseIdempotencyKey } from '../ingestion/schema';
import { ingestFailure } from '../ingestion/service';

/**
 * Phase 4 — Failure Ingestion.
 *
 *   Incoming Failure -> API Validation -> Normalization -> Payment Lookup
 *     -> Idempotency Check -> Persist Failure -> Append Audit Event -> Result
 *
 * This handler owns only the HTTP edge: header + body validation and mapping
 * the pipeline's tagged result onto a status code. All persistence, the
 * transaction and the audit event live in `ingestion/service.ts`.
 */
export const failureRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/payments/failures', async (request, reply) => {
    // --- Idempotency-Key header (required) ------------------------------
    const keyResult = parseIdempotencyKey(request.headers['idempotency-key']);
    if (!keyResult.ok) {
      return reply.code(400).send({
        status: 'INVALID',
        error: 'A non-empty "Idempotency-Key" header is required (max 255 chars).',
      });
    }

    // --- API Validation -------------------------------------------------
    const parsed = parseFailurePayload(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({
        status: 'INVALID',
        error: 'Request body failed validation.',
        issues: parsed.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // --- Normalization ------------------------------------------------
    const normalized = normalizeFailure(parsed.value);
    if (!normalized.ok) {
      return reply.code(422).send({ status: 'UNPROCESSABLE', error: normalized.message });
    }

    // --- Lookup -> Idempotency -> Persist -> Audit (service) -------
    const result = await ingestFailure({
      normalized: normalized.value,
      idempotencyKey: keyResult.key,
      rawPayload: request.body,
      normalizationNotes: normalized.notes,
    });

    switch (result.status) {
      case 'ACCEPTED':
        return reply.code(201).send({
          status: 'ACCEPTED',
          duplicate: false,
          failureId: result.failureId,
          paymentId: result.paymentId,
        });
      case 'DUPLICATE':
        return reply.code(200).send({
          status: 'DUPLICATE',
          duplicate: true,
          failureId: result.failureId,
          paymentId: result.paymentId,
        });
      case 'PAYMENT_NOT_FOUND':
        return reply.code(404).send({
          status: 'PAYMENT_NOT_FOUND',
          error: `No payment found with id "${result.paymentId}".`,
          paymentId: result.paymentId,
        });
      case 'UNPROCESSABLE':
        return reply.code(422).send({ status: 'UNPROCESSABLE', error: result.message });
    }
  });
};
