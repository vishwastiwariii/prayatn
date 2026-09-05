import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export type Role = 'admin' | 'operator' | 'demo';

declare module 'fastify' {
  interface FastifyRequest {
    /** Null when auth is disabled (development) or the route is public. */
    role: Role | null;
  }
}

/**
 * Phase 14 §1 — authentication + authorization.
 *
 * Service-to-service bearer tokens with three roles. Classification is
 * CENTRAL and DENY-BY-DEFAULT: a route nobody thought about requires `admin`,
 * so forgetting to protect a new endpoint fails closed rather than open.
 *
 * Scope, stated honestly: this is machine auth for the API. There is no
 * browser login flow — the dashboard is a trusted-network operator tool. In
 * a real deployment the dashboard would sit behind an SSO proxy, and
 * `POST /api/payments/failures` would additionally verify a gateway webhook
 * signature rather than a shared key.
 */
interface Rule {
  method?: string;
  /** Matched against the request path. */
  test: (path: string) => boolean;
  roles: Role[];
}

const startsWith = (prefix: string) => (path: string) => path.startsWith(prefix);
const matches = (re: RegExp) => (path: string) => re.test(path);

/** Ordered: first match wins. Anything unmatched falls through to admin-only. */
const RULES: Rule[] = [
  // Demo control plane — its own role so a demo token cannot touch real ops.
  { test: startsWith('/api/demo/'), roles: ['demo', 'admin'] },

  // Running an experiment is compute-heavy; keep it to admins.
  { method: 'POST', test: (p) => p === '/api/evaluations', roles: ['admin'] },

  // Everything an operator does day to day.
  { test: startsWith('/api/payments'), roles: ['operator', 'admin'] },
  { test: startsWith('/api/recovery-actions'), roles: ['operator', 'admin'] },
  { test: startsWith('/api/human-review'), roles: ['operator', 'admin'] },
  { test: startsWith('/api/dashboard'), roles: ['operator', 'admin'] },
  { test: startsWith('/api/gateway'), roles: ['operator', 'admin'] },
  { method: 'GET', test: matches(/^\/api\/evaluations\//), roles: ['operator', 'admin'] },
];

/** Health probes are the only unauthenticated surface. */
function isPublic(path: string): boolean {
  return path === '/health' || path.startsWith('/health/');
}

function requiredRoles(method: string, path: string): Role[] {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue;
    if (rule.test(path)) return rule.roles;
  }
  return ['admin']; // deny by default
}

function presentedToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null;
}

/** Constant-time compare so a token cannot be recovered by timing the API. */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const authPlugin: FastifyPluginAsync = async (app) => {
  const keys: Array<{ role: Role; key: string | undefined }> = [
    { role: 'admin', key: app.env.ADMIN_API_KEY },
    { role: 'operator', key: app.env.OPERATOR_API_KEY },
    { role: 'demo', key: app.env.DEMO_API_KEY },
  ];

  app.decorateRequest('role', null);

  if (!app.env.AUTH_ENABLED) {
    app.log.warn(
      { event: 'auth.disabled' },
      'AUTH_ENABLED=false — the API is unauthenticated. This is refused in production (see env.ts).',
    );
    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (isPublic(path)) return;

    const token = presentedToken(request);
    if (!token) {
      return reply.code(401).send({
        status: 'UNAUTHENTICATED',
        error: 'Missing bearer token.',
        statusCode: 401,
        requestId: request.requestId,
      });
    }

    const matched = keys.find(({ key }) => key && secretEquals(key, token));
    if (!matched) {
      request.log.warn({ event: 'auth.rejected', requestId: request.requestId, path }, 'invalid token');
      return reply.code(401).send({
        status: 'UNAUTHENTICATED',
        error: 'Invalid token.',
        statusCode: 401,
        requestId: request.requestId,
      });
    }

    request.role = matched.role;
    const allowed = requiredRoles(request.method, path);
    if (!allowed.includes(matched.role)) {
      request.log.warn(
        { event: 'auth.forbidden', requestId: request.requestId, role: matched.role, path },
        'role not permitted for route',
      );
      return reply.code(403).send({
        status: 'FORBIDDEN',
        error: `Role "${matched.role}" may not access this endpoint.`,
        statusCode: 403,
        requestId: request.requestId,
      });
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
export { requiredRoles, isPublic };
