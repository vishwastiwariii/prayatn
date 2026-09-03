import type { FailureSource, FailureStep, PaymentMethod } from '@recovery-desk/domain';

/**
 * The provider-agnostic failure shape the rest of the system works with.
 *
 * Every accepted wire format (Razorpay `payment.failed` webhook, the flat
 * partner payload, ...) is mapped onto exactly this structure by
 * `normalizeFailure` before anything is persisted. Downstream phases
 * (classifier, policy engine) never see a raw provider payload.
 */
export interface NormalizedFailure {
  paymentId: string;
  /** Major currency units (e.g. rupees) as a fixed 2dp decimal string. */
  amount: string;
  currency: string;
  method: PaymentMethod;
  error: {
    code: string;
    reason: string;
    source: FailureSource;
    step: FailureStep;
    description: string;
  };
  occurredAt: Date;
  /** Which wire format this was decoded from — recorded on the audit event. */
  ingestionSource: 'RAZORPAY_WEBHOOK' | 'FLAT_PAYLOAD';
}

/** Result of the pure normalization step. */
export type NormalizationResult =
  { ok: true; value: NormalizedFailure; notes: string[] } | { ok: false; message: string };

/** Outcome of the full ingestion pipeline (service layer, framework-free). */
export type IngestionResult =
  | { status: 'ACCEPTED'; failureId: string; paymentId: string }
  | { status: 'DUPLICATE'; failureId: string; paymentId: string }
  | { status: 'PAYMENT_NOT_FOUND'; paymentId: string }
  | { status: 'UNPROCESSABLE'; message: string };
