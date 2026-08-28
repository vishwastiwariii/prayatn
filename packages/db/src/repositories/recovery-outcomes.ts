import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

export function createRecoveryOutcomeRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.RecoveryOutcomeUncheckedCreateInput) {
      return db.recoveryOutcome.create({ data });
    },

    findById(id: string) {
      return db.recoveryOutcome.findUnique({ where: { id } });
    },

    findByActionId(actionId: string) {
      return db.recoveryOutcome.findUnique({ where: { actionId } });
    },

    list(args?: Prisma.RecoveryOutcomeFindManyArgs) {
      return db.recoveryOutcome.findMany(args);
    },
  };
}

export type RecoveryOutcomeRepository = ReturnType<typeof createRecoveryOutcomeRepository>;
