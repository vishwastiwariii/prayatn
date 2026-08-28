import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma, RecoveryActionStatus } from '../generated/client';

const OPEN_STATUSES: RecoveryActionStatus[] = ['PENDING', 'SCHEDULED'];

export function createRecoveryActionRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.RecoveryActionUncheckedCreateInput) {
      return db.recoveryAction.create({ data });
    },

    findById(id: string) {
      return db.recoveryAction.findUnique({ where: { id } });
    },

    /** Idempotency lookup for the recovery worker (Phase 9). */
    findByIdempotencyKey(idempotencyKey: string) {
      return db.recoveryAction.findUnique({ where: { idempotencyKey } });
    },

    update(id: string, data: Prisma.RecoveryActionUncheckedUpdateInput) {
      return db.recoveryAction.update({ where: { id }, data });
    },

    setStatus(id: string, status: RecoveryActionStatus) {
      return db.recoveryAction.update({ where: { id }, data: { status } });
    },

    markExecuted(id: string, executedAt: Date = new Date()) {
      return db.recoveryAction.update({
        where: { id },
        data: { status: 'EXECUTED', executedAt },
      });
    },

    /** Actions that are due to run at or before `asOf`. */
    listDue(asOf: Date = new Date()) {
      return db.recoveryAction.findMany({
        where: { status: 'SCHEDULED', scheduledFor: { lte: asOf } },
        orderBy: { scheduledFor: 'asc' },
      });
    },

    listByPayment(paymentId: string) {
      return db.recoveryAction.findMany({
        where: { paymentId },
        orderBy: { createdAt: 'desc' },
      });
    },

    /** Mandate kill switch (Phase 14): cancel every not-yet-executed action. */
    cancelOpenForPayment(paymentId: string) {
      return db.recoveryAction.updateMany({
        where: { paymentId, status: { in: OPEN_STATUSES } },
        data: { status: 'CANCELLED' },
      });
    },
  };
}

export type RecoveryActionRepository = ReturnType<typeof createRecoveryActionRepository>;
