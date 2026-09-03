import {
  CLASSIFIER_VERSION,
  classify,
  type ClassificationResult,
  type ClassifierInput,
} from '@recovery-desk/classifier';
import {
  Prisma,
  type FailureSource,
  type FailureStep,
  type PaymentMethod,
  type RecoveryStatus,
  type RootCause,
  createRepositories,
  prismaClient,
  withTransaction,
} from '@recovery-desk/db';

/**
 * Classification service (framework-free).
 *
 *   Load failure -> Idempotency check -> classify() [pure]
 *                -> persist classification + audit (one transaction) -> result
 *
 * DIAGNOSIS ONLY. This service records a root cause, a confidence and an
 * explanation. It never picks, schedules or authorises a recovery action.
 */

export interface FailureContext {
  failureId: string;
  paymentId: string;
  errorCode: string;
  errorReason: string;
  errorSource: FailureSource;
  errorStep: FailureStep;
  errorDescription: string;
  method: PaymentMethod;
  paymentRecoveryStatus: RecoveryStatus | null;
}

export interface StoredClassification {
  id: string;
  failureId: string;
  cause: RootCause;
  confidence: number;
  ruleId: string | null;
  classifierVersion: string;
  source: string;
  evidence: string[];
  explanation: string | null;
  createdAt: Date;
}

export interface PersistArgs {
  failure: FailureContext;
  result: ClassificationResult;
}

export interface ClassifyFailureDeps {
  loadFailureContext(failureId: string): Promise<FailureContext | null>;
  findExistingClassification(
    failureId: string,
    classifierVersion: string,
  ): Promise<StoredClassification | null>;
  persistClassification(args: PersistArgs): Promise<StoredClassification>;
}

export type ClassifyFailureResult =
  | {
      status: 'CLASSIFIED';
      duplicate: false;
      classification: StoredClassification;
      result: ClassificationResult;
    }
  | { status: 'DUPLICATE'; duplicate: true; classification: StoredClassification }
  | { status: 'FAILURE_NOT_FOUND'; failureId: string };

export async function classifyFailure(
  failureId: string,
  deps: ClassifyFailureDeps = liveDeps,
): Promise<ClassifyFailureResult> {
  // --- Load failure ----------------------------------------------------
  const failure = await deps.loadFailureContext(failureId);
  if (!failure) {
    return { status: 'FAILURE_NOT_FOUND', failureId };
  }

  // --- Idempotency check (one classification per failure per version) --
  const existing = await deps.findExistingClassification(failureId, CLASSIFIER_VERSION);
  if (existing) {
    return { status: 'DUPLICATE', duplicate: true, classification: existing };
  }

  // --- Pure rule evaluation -----------------------------------------
  const input: ClassifierInput = {
    errorCode: failure.errorCode,
    errorReason: failure.errorReason,
    errorSource: failure.errorSource,
    errorStep: failure.errorStep,
    errorDescription: failure.errorDescription,
    method: failure.method,
  };
  const result = classify(input);

  // --- Persist + audit (transactional) ----------------------------
  try {
    const classification = await deps.persistClassification({ failure, result });
    return { status: 'CLASSIFIED', duplicate: false, classification, result };
  } catch (err) {
    // Concurrent classify of the same failure: the unique index
    // (failureId, classifierVersion) rejected the second insert.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await deps.findExistingClassification(failureId, CLASSIFIER_VERSION);
      if (winner) {
        return { status: 'DUPLICATE', duplicate: true, classification: winner };
      }
    }
    throw err;
  }
}

// --- live wiring ------------------------------------------------------

function toStored(row: {
  id: string;
  failureId: string;
  cause: RootCause;
  confidence: number;
  ruleId: string | null;
  classifierVersion: string;
  source: string;
  evidence: string[];
  explanation: string | null;
  createdAt: Date;
}): StoredClassification {
  return {
    id: row.id,
    failureId: row.failureId,
    cause: row.cause,
    confidence: row.confidence,
    ruleId: row.ruleId,
    classifierVersion: row.classifierVersion,
    source: row.source,
    evidence: row.evidence,
    explanation: row.explanation,
    createdAt: row.createdAt,
  };
}

function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function buildAuditEvent(
  failure: FailureContext,
  result: ClassificationResult,
  classificationId: string,
  movedRecoveryStatus: boolean,
) {
  return {
    paymentId: failure.paymentId,
    eventType: 'FAILURE_CLASSIFIED',
    whatWeSaw:
      `Failure ${failure.failureId} on ${failure.method} payment ${failure.paymentId}: ` +
      `code=${failure.errorCode}, reason=${failure.errorReason}, ` +
      `source=${failure.errorSource}, step=${failure.errorStep}.`,
    whatWeConcluded:
      `Root cause = ${result.cause} at ${pct(result.confidence)} confidence ` +
      `(rule ${result.ruleId}). ${result.explanation}`,
    whatWasAllowed:
      'Diagnosis only. Record a root cause, confidence and explanation. ' +
      'No recovery action may be chosen, scheduled or authorised here.',
    whatWeDid: movedRecoveryStatus
      ? `Persisted classification ${classificationId} (source=RULE, version ${result.classifierVersion}) ` +
        `and moved payment recovery status FAILED -> CLASSIFIED.`
      : `Persisted classification ${classificationId} (source=RULE, version ${result.classifierVersion}); ` +
        `left payment recovery status at ${failure.paymentRecoveryStatus ?? 'null'}.`,
    whatHappened: 'Root cause recorded. Awaiting policy evaluation (Phase 7).',
    metadata: {
      classificationId,
      failureId: failure.failureId,
      cause: result.cause,
      confidence: result.confidence,
      ruleId: result.ruleId,
      classifierVersion: result.classifierVersion,
      evidence: result.evidence,
      candidates: result.candidates.map((c) => ({
        ruleId: c.ruleId,
        cause: c.cause,
        priority: c.priority,
        confidence: c.confidence,
      })),
      previousRecoveryStatus: failure.paymentRecoveryStatus,
      newRecoveryStatus: movedRecoveryStatus ? 'CLASSIFIED' : failure.paymentRecoveryStatus,
    } satisfies Prisma.InputJsonObject,
  };
}

export const liveDeps: ClassifyFailureDeps = {
  async loadFailureContext(failureId) {
    const row = await prismaClient.paymentFailure.findUnique({
      where: { id: failureId },
      include: { payment: true },
    });
    if (!row) return null;
    return {
      failureId: row.id,
      paymentId: row.paymentId,
      errorCode: row.errorCode,
      errorReason: row.errorReason,
      errorSource: row.errorSource,
      errorStep: row.errorStep,
      errorDescription: row.errorDescription,
      method: row.payment.method,
      paymentRecoveryStatus: row.payment.recoveryStatus,
    };
  },

  async findExistingClassification(failureId, classifierVersion) {
    const repos = createRepositories();
    const row = await repos.classifications.findByFailureAndVersion(failureId, classifierVersion);
    return row ? toStored(row) : null;
  },

  persistClassification({ failure, result }) {
    return withTransaction(async (tx) => {
      const repos = createRepositories(tx);

      const row = await repos.classifications.create({
        failureId: failure.failureId,
        cause: result.cause,
        confidence: result.confidence,
        ruleId: result.ruleId,
        classifierVersion: result.classifierVersion,
        source: 'RULE',
        evidence: result.evidence,
        explanation: result.explanation,
      });

      const movedRecoveryStatus = failure.paymentRecoveryStatus === 'FAILED';
      if (movedRecoveryStatus) {
        // Pipeline bookkeeping, not a recovery decision: FAILED -> CLASSIFIED.
        await repos.payments.setRecoveryStatus(failure.paymentId, 'CLASSIFIED');
      }

      await repos.auditEvents.append(buildAuditEvent(failure, result, row.id, movedRecoveryStatus));

      return toStored(row);
    });
  },
};
