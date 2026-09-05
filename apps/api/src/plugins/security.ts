import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Phase 14 §1 — transport-level hardening: security headers, a rate limit and
 * a consistent 429 shape. The body-size ceiling is set on the Fastify
 * instance itself (see `app.ts`), because it has to be in place before a
 * request body is read.
 */
const securityPlugin: FastifyPluginAsync = async (app) => {
  await app.register(helmet, {
    // This is a JSON API — no inline scripts, no framing, no sniffing.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense over TLS; the reverse proxy owns that in prod.
    hsts: app.env.NODE_ENV === 'production',
  });

  await app.register(rateLimit, {
    max: app.env.RATE_LIMIT_MAX,
    timeWindow: app.env.RATE_LIMIT_WINDOW,
    // Health checks are what a load balancer hammers; never rate-limit them.
    allowList: (request) => request.url.startsWith('/health'),
    errorResponseBuilder: (_request, context) => ({
      status: 'RATE_LIMITED',
      error: `Too many requests. Retry in ${context.after}.`,
      statusCode: 429,
    }),
  });
};

export default fp(securityPlugin, { name: 'security' });
