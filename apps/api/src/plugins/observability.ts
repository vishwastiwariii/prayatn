import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation id for this request, echoed back as `x-request-id`. */
    requestId: string;
  }
}

/**
 * Phase 14 §8 — correlation IDs and structured request logging.
 *
 * Every log line for a request carries the same `requestId`, and the client
 * gets it back in a header, so a payment that misbehaved in the dashboard can
 * be traced to the exact API call and the exact worker job that followed it.
 *
 * Deliberately NOT logged: request bodies (they carry payment/customer data),
 * headers (they carry API keys), and query strings beyond the route.
 */
const observabilityPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (request, reply) => {
    // `request.id` is set by `genReqId` in app.ts (inbound header or a UUID),
    // and Fastify already stamps it on every log line for this request.
    request.requestId = request.id;
    void reply.header('x-request-id', request.requestId);
  });
};

export default fp(observabilityPlugin, { name: 'observability' });
