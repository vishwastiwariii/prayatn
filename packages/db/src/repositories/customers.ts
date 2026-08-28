import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

export function createCustomerRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.CustomerUncheckedCreateInput) {
      return db.customer.create({ data });
    },

    findById(id: string) {
      return db.customer.findUnique({ where: { id } });
    },

    findByEmail(email: string) {
      return db.customer.findUnique({ where: { email } });
    },

    upsertByEmail(
      email: string,
      create: Prisma.CustomerUncheckedCreateInput,
      update: Prisma.CustomerUncheckedUpdateInput = {},
    ) {
      return db.customer.upsert({ where: { email }, create, update });
    },

    list(args?: Prisma.CustomerFindManyArgs) {
      return db.customer.findMany(args);
    },
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
