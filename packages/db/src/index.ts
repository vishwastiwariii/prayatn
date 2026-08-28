/**
 * `@recovery-desk/db` — the single place that owns Prisma, the schema, the
 * generated client and the persistence (repository) layer.
 *
 *   import { prismaClient, repositories, withTransaction } from '@recovery-desk/db';
 *
 * Generated enums and model/row types are re-exported too, e.g. `PaymentMethod`,
 * `RootCause`, `Payment`, `Prisma`.
 */
export { prismaClient } from './client';
export { withTransaction } from './transaction';
export type { Database, TransactionClient } from './transaction';

// Prisma namespace, PrismaClient, all enums and generated row types.
export * from './generated/client';

// Repository factories + the default `repositories` bundle.
export * from './repositories';
