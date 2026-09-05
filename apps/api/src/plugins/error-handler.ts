import type { FastifyError, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Phase 14 §1 — one error shape for the whole API, and no stack traces or
 * internal messages leaving the process in production.
 *
 *   { status, error, statusCode, requestId }
 *
 * The requestId is the bridge: a user reports "it said INTERNAL_ERROR with id
 * X", and that id is in the server logs next to the real stack.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  const isProd = app.env.NODE_ENV === 'production';

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    // 4xx are the caller's problem and safe to describe. 5xx are ours: log the
    // real error, return a generic one.
    if (statusCode >= 500) {
      request.log.error(
        { event: 'http.error', requestId: request.requestId, err: error, statusCode },
        'request failed',
      );
    } else {
      request.log.warn(
        { event: 'http.rejected', requestId: request.requestId, statusCode, code: error.code },
        error.message,
      );
    }

    const body = {
      status: statusCode >= 500 ? 'INTERNAL_ERROR' : (error.code ?? 'REQUEST_ERROR'),
      error:
        statusCode >= 500 && isProd
          ? 'An internal error occurred. Quote the requestId when reporting this.'
          : error.message,
      statusCode,
      requestId: request.requestId,
    };

    void reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      status: 'NOT_FOUND',
      error: `Route ${request.method} ${request.url} not found.`,
      statusCode: 404,
      requestId: request.requestId,
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
