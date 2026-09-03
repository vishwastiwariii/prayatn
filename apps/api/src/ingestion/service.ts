import {
  Prisma,
  type PaymentStatus,
  createRepositories,
  repositories as defaultRepositories,
  withTransaction as defaultWithTransaction,
} from '@recovery-desk/db';
import type { IngestionResult, NormalizedFailure } from './types';

/**
 * Ingestion pipeline (service layer). Framework-free: no Fastify, no HTTP.
 *
 *   Payment Lookup -> Idempotency Check -> Persist Failure
 *                  -> Update Payment status -> Append Audit Event -> Result
 *
 * The persist / status-update / audit steps run inside ONE interactive
 * transaction, so a crash between them can never leave a failure row without
 * its audit event (or vice versa).
 */

// A payment already in one of these states is not moved back to FAILED; the
// failure row is still stored for history/audit.
const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'SUCCEEDED',
  'HARD_STOPPED',
  'EXHAUSTED',
]);

export interface IngestFailureDeps {
  repositories: Pick<ReturnType<typeof createRepositories>, 'payments' | 'paymentFailures'>;
  withTransaction: typeof defaultWithTransaction;
}

const liveDeps: IngestFailureDeps = {
  repositories: defaultRepositories,
  withTransaction: defaultWithTransaction,
};

export interface IngestFailureInput {
  normalized: NormalizedFailure;
  idempotencyKey: string;
  /** The untouched request body, stored verbatim on the failure row. */
  rawPayload: unknown;
  /** Human-readable normalization adjustments, for the audit trail. */
  normalizationNotes: string[];
}

export async function ingestFailure(
  input: IngestFailureInput,
  deps: IngestFailureDeps = liveDeps,
): Promise<IngestionResult> {
  const { normalized, idempotencyKey, rawPayload, normalizationNotes } = input;
  const { repositories, withTransaction } = deps;

  // --- Payment Lookup -----------------------------------------------------
  const payment = await repositories.payments.findById(normalized.paymentId);
  if (!payment) {
    return { status: 'PAYMENT_NOT_FOUND', paymentId: normalized.paymentId };
  }

  // --- Idempotency Check (fast path, pre-transaction) -------------------
  const seen = await repositories.paymentFailures.findByIdempotencyKey(idempotencyKey);
  if (seen) {
    return { status: 'DUPLICATE', failureId: seen.id, paymentId: seen.paymentId };
  }

  try {
    return await withTransaction(async (tx) => {
      const repos = createRepositories(tx);

      // Re-check inside the transaction to shrink the race window; the unique
      // index on `idempotency_key` is the real guarantee (see catch below).
      const raced = await repos.paymentFailures.findByIdempotencyKey(idempotencyKey);
      if (raced) {
        return { status: 'DUPLICATE', failureId: raced.id, paymentId: raced.paymentId };
      }

      // --- Persist Failure ---------------------------------------------
      const failure = await repos.paymentFailures.create({
        paymentId: payment.id,
        errorCode: normalized.error.code,
        errorReason: normalized.error.reason,
        errorSource: normalized.error.source,
        errorStep: normalized.error.step,
        errorDescription: normalized.error.description,
        rawPayload: toJson(rawPayload),
        idempotencyKey,
        occurredAt: normalized.occurredAt,
      });

      // --- Update Payment status -------------------------------------
      // Each distinct failure event (new idempotency key) is one real-world
      // attempt that failed, so it bumps `attemptCount`. A payment already in a
      // terminal state keeps its status; the failure row is still recorded.
      const previousStatus = payment.status;
      let newStatus = previousStatus;
      let statusHandling: 'CHANGED' | 'REFAILED' | 'TERMINAL';
      if (TERMINAL_STATUSES.has(previousStatus)) {
        statusHandling = 'TERMINAL';
      } else {
        await repos.payments.updateStatus(payment.id, 'FAILED', 'FAILED');
        await repos.payments.incrementAttemptCount(payment.id);
        newStatus = 'FAILED';
        statusHandling = previousStatus === 'FAILED' ? 'REFAILED' : 'CHANGED';
      }

      // --- Append Audit Event --------------------------------------
      await repos.auditEvents.append(
        buildAuditEvent({
          normalized,
          failureId: failure.id,
          idempotencyKey,
          previousStatus,
          newStatus,
          statusHandling,
          normalizationNotes,
        }),
      );

      return { status: 'ACCEPTED', failureId: failure.id, paymentId: payment.id };
    });
  } catch (err) {
    // A concurrent request won the race and inserted first: the unique index
    // rejected our insert. That is a successful de-dupe, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await repositories.paymentFailures.findByIdempotencyKey(idempotencyKey);
      if (winner) {
        return { status: 'DUPLICATE', failureId: winner.id, paymentId: winner.paymentId };
      }
    }
    throw err;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  // The body already came off `JSON.parse`, so it is always JSON-serializable.
  return value as Prisma.InputJsonValue;
}

interface AuditInput {
  normalized: NormalizedFailure;
  failureId: string;
  idempotencyKey: string;
  previousStatus: PaymentStatus;
  newStatus: PaymentStatus;
  statusHandling: 'CHANGED' | 'REFAILED' | 'TERMINAL';
  normalizationNotes: string[];
}

const WHAT_WE_DID: Record<AuditInput['statusHandling'], (a: AuditInput) => string> = {
  CHANGED: (a) =>
    `Stored payment_failure ${a.failureId} and moved payment ${a.previousStatus} -> ${a.newStatus}; ` +
    `attempt count bumped to reflect the failed attempt.`,
  REFAILED: (a) =>
    `Stored payment_failure ${a.failureId}; payment was already FAILED, recorded another failed attempt.`,
  TERMINAL: (a) =>
    `Stored payment_failure ${a.failureId}; left payment status at ${a.previousStatus} ` +
    `(terminal state, not moved to FAILED).`,
};

function buildAuditEvent(a: AuditInput) {
  const { normalized: n, normalizationNotes: notes } = a;

  return {
    paymentId: n.paymentId,
    eventType: 'FAILURE_INGESTED',
    whatWeSaw:
      `${n.method} payment ${n.paymentId} (${n.currency} ${n.amount}) reported failed ` +
      `via ${n.ingestionSource}: code=${n.error.code}, reason=${n.error.reason}, ` +
      `source=${n.error.source}, step=${n.error.step}.`,
    whatWeConcluded:
      notes.length > 0
        ? `Normalized to the domain failure model with adjustments: ${notes.join('; ')}.`
        : 'Payload mapped cleanly onto the domain failure model with no adjustments.',
    whatWasAllowed:
      'Record the failure and move the payment into the recovery pipeline. ' +
      'No retry, rail-switch or authorization decision is taken at ingestion.',
    whatWeDid: WHAT_WE_DID[a.statusHandling](a),
    whatHappened: 'Failure persisted. Awaiting deterministic classification (Phase 6).',
    metadata: {
      failureId: a.failureId,
      idempotencyKey: a.idempotencyKey,
      ingestionSource: n.ingestionSource,
      errorReason: n.error.reason,
      previousStatus: a.previousStatus,
      newStatus: a.newStatus,
      statusHandling: a.statusHandling,
      normalizationNotes: notes,
    } satisfies Prisma.InputJsonObject,
  };
}
