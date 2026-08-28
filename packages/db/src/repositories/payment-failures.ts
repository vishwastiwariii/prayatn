import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

export function createPaymentFailureRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.PaymentFailureUncheckedCreateInput) {
      return db.paymentFailure.create({ data });
    },

    findById(id: string) {
      return db.paymentFailure.findUnique({ where: { id } });
    },

    /** Used by Phase 4 ingestion to make POSTs idempotent. */
    findByIdempotencyKey(idempotencyKey: string) {
      return db.paymentFailure.findUnique({ where: { idempotencyKey } });
    },

    listByPayment(paymentId: string) {
      return db.paymentFailure.findMany({
        where: { paymentId },
        orderBy: { occurredAt: 'desc' },
      });
    },
  };
}

export type PaymentFailureRepository = ReturnType<typeof createPaymentFailureRepository>;
