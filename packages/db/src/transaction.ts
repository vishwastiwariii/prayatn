import { prismaClient } from './client';
import type { Prisma, PrismaClient } from './generated/client';

/**
 * A query runner: either the root client or an interactive transaction client.
 * Every repository factory accepts one of these so the same repository code
 * works inside and outside a transaction.
 */
export type Database = PrismaClient | Prisma.TransactionClient;

export type TransactionClient = Prisma.TransactionClient;

/**
 * Run `fn` inside a single database transaction. Throwing inside `fn` rolls the
 * whole thing back.
 */
export function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  return prismaClient.$transaction(fn, options);
}
