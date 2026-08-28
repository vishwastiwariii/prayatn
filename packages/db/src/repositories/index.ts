import { prismaClient } from '../client';
import type { Database } from '../transaction';
import { createCustomerRepository } from './customers';
import { createPaymentRepository } from './payments';
import { createPaymentFailureRepository } from './payment-failures';
import { createClassificationRepository } from './classifications';
import { createRecoveryActionRepository } from './recovery-actions';
import { createRecoveryOutcomeRepository } from './recovery-outcomes';
import { createAuditEventRepository } from './audit-events';

export * from './customers';
export * from './payments';
export * from './payment-failures';
export * from './classifications';
export * from './recovery-actions';
export * from './recovery-outcomes';
export * from './audit-events';

/** Build the full repository set bound to a given client (or a transaction). */
export function createRepositories(db: Database = prismaClient) {
  return {
    customers: createCustomerRepository(db),
    payments: createPaymentRepository(db),
    paymentFailures: createPaymentFailureRepository(db),
    classifications: createClassificationRepository(db),
    recoveryActions: createRecoveryActionRepository(db),
    recoveryOutcomes: createRecoveryOutcomeRepository(db),
    auditEvents: createAuditEventRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/** Ready-to-use repositories bound to the shared `prismaClient`. */
export const repositories: Repositories = createRepositories();
