import { prismaClient } from '../client';
import type { Database } from '../transaction';
import type { Prisma } from '../generated/client';

export function createClassificationRepository(db: Database = prismaClient) {
  return {
    create(data: Prisma.ClassificationUncheckedCreateInput) {
      return db.classification.create({ data });
    },

    findById(id: string) {
      return db.classification.findUnique({ where: { id } });
    },

    /** Idempotency lookup for the classification service (one per version). */
    findByFailureAndVersion(failureId: string, classifierVersion: string) {
      return db.classification.findUnique({
        where: { failureId_classifierVersion: { failureId, classifierVersion } },
      });
    },

    listByFailure(failureId: string) {
      return db.classification.findMany({
        where: { failureId },
        orderBy: { createdAt: 'desc' },
      });
    },

    latestForFailure(failureId: string) {
      return db.classification.findFirst({
        where: { failureId },
        orderBy: { createdAt: 'desc' },
      });
    },

    /**
     * Phase 12: the classification the POLICY ENGINE is allowed to treat as
     * authoritative — RULE (deterministic classifier) or HUMAN (a reviewer's
     * decision). Deliberately excludes LLM_SUGGESTION: an AI suggestion must
     * never become "the" classification just by being the newest row.
     */
    latestDecisionEligibleForFailure(failureId: string) {
      return db.classification.findFirst({
        where: { failureId, source: { in: ['RULE', 'HUMAN'] } },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}

export type ClassificationRepository = ReturnType<typeof createClassificationRepository>;
