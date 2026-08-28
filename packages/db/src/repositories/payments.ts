import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma, PaymentStatus, RecoveryStatus } from '../generated/client';

export function createPaymentRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.PaymentUncheckedCreateInput) {
      return db.payment.create({ data });
    },

    findById(id: string) {
      return db.payment.findUnique({ where: { id } });
    },

    findByIdWithRelations(id: string) {
      return db.payment.findUnique({
        where: { id },
        include: {
          customer: true,
          failures: { orderBy: { occurredAt: 'desc' } },
          recoveryActions: { orderBy: { createdAt: 'desc' }, include: { outcome: true } },
        },
      });
    },

    updateStatus(id: string, status: PaymentStatus, recoveryStatus?: RecoveryStatus) {
      return db.payment.update({
        where: { id },
        data: { status, ...(recoveryStatus ? { recoveryStatus } : {}) },
      });
    },

    setRecoveryStatus(id: string, recoveryStatus: RecoveryStatus) {
      return db.payment.update({ where: { id }, data: { recoveryStatus } });
    },

    incrementAttemptCount(id: string) {
      return db.payment.update({
        where: { id },
        data: { attemptCount: { increment: 1 } },
      });
    },

    list(args?: Prisma.PaymentFindManyArgs) {
      return db.payment.findMany(args);
    },
  };
}

export type PaymentRepository = ReturnType<typeof createPaymentRepository>;
