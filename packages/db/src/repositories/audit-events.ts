import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

/**
 * `audit_events` is append-only. This repository deliberately exposes only
 * `append` and read methods — no update, no delete.
 */
export function createAuditEventRepository(db: Database = prismaClient) {
  return {
    append(data: Prisma.AuditEventUncheckedCreateInput) {
      return db.auditEvent.create({ data });
    },

    findById(id: string) {
      return db.auditEvent.findUnique({ where: { id } });
    },

    listByPayment(paymentId: string) {
      return db.auditEvent.findMany({
        where: { paymentId },
        orderBy: { createdAt: 'asc' },
      });
    },

    list(args?: Prisma.AuditEventFindManyArgs) {
      return db.auditEvent.findMany(args);
    },
  };
}

export type AuditEventRepository = ReturnType<typeof createAuditEventRepository>;
