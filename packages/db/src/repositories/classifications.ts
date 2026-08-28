import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

export function createClassificationRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.ClassificationUncheckedCreateInput) {
      return db.classification.create({ data });
    },

    findById(id: string) {
      return db.classification.findUnique({ where: { id } });
    },

    listByFailure(failureId: string) {
      return db.classification.findMany({
        where: { failureId },
        orderBy: { createdAt: 'desc' },
      });
    },

    latestForFailure(failureId: string) {
      return db.classification.findFirst({
        where: { failureId },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}

export type ClassificationRepository = ReturnType<typeof createClassificationRepository>;
