import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

/**
 * Phase 12 §9-10 — customer messages generated for an already-approved
 * recovery action. At most one per action; idempotency is enforced by the
 * unique constraints on `recoveryActionId` and `idempotencyKey`.
 */
export function createRecoveryMessageRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.RecoveryMessageUncheckedCreateInput) {
      return db.recoveryMessage.create({ data });
    },

    findByRecoveryActionId(recoveryActionId: string) {
      return db.recoveryMessage.findUnique({ where: { recoveryActionId } });
    },

    findByIdempotencyKey(idempotencyKey: string) {
      return db.recoveryMessage.findUnique({ where: { idempotencyKey } });
    },

    listByPayment(paymentId: string) {
      return db.recoveryMessage.findMany({ where: { paymentId }, orderBy: { createdAt: 'desc' } });
    },
  };
}

export type RecoveryMessageRepository = ReturnType<typeof createRecoveryMessageRepository>;
