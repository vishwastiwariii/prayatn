import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { prismaClient, type PrismaClient } from '@recovery-desk/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// Uses the shared singleton from @recovery-desk/db. Prisma connects lazily on
// first query, so registering this plugin never needs a live database.
const prismaPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('prisma', prismaClient);
  app.addHook('onClose', async () => {
    await prismaClient.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
