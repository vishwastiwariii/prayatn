import type { FastifyPluginAsync } from 'fastify';
import { type DashboardReader, liveDashboardReader } from '../dashboard/service';

/**
 * Phase 11 §25 — aggregated dashboard data.
 *
 *   GET /api/dashboard/summary
 *
 * READ ONLY. All aggregation happens server-side (`dashboard/service.ts`);
 * this handler only maps the reader's result onto the HTTP response.
 */
export interface DashboardRouteDeps {
  reader?: DashboardReader;
}

export function createDashboardRoutes(deps: DashboardRouteDeps = {}): FastifyPluginAsync {
  const reader = deps.reader ?? liveDashboardReader;

  return async (app) => {
    app.get('/api/dashboard/summary', async (_request, reply) => {
      const summary = await reader.getSummary();
      return reply.code(200).send(summary);
    });
  };
}
