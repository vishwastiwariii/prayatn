import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// The client is created eagerly but only connects on first query, which keeps
// `buildApp` usable in tests without a live database.
const prismaPlugin: FastifyPluginAsync = async (app) => {
  const prisma = new PrismaClient();

  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
