import { PrismaClient } from './generated/client';

/**
 * Single shared PrismaClient for the whole monorepo.
 *
 * Import it anywhere:
 *
 *   import { prismaClient } from '@recovery-desk/db';
 *
 * A module-level singleton is cached on `globalThis` in non-production so that
 * dev/watch reloads and test files reuse one connection pool instead of
 * exhausting Postgres with a new client per reload.
 */
const globalForPrisma = globalThis as unknown as {
  __recoveryDeskPrisma__?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export const prismaClient: PrismaClient =
  globalForPrisma.__recoveryDeskPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__recoveryDeskPrisma__ = prismaClient;
}
