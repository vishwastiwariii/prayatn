import { z } from 'zod';

/**
 * API validation layer.
 *
 * Two wire formats are accepted and validated here; neither is trusted past
 * this point. Normalization (`normalize.ts`) turns whichever one parsed into a
 * single `NormalizedFailure`.
 *
 *   1. RAZORPAY_WEBHOOK  — the real `payment.failed` webhook envelope
 *      (amounts in paise, `error_*` fields, `payment_authorization` steps).
 *   2. FLAT_PAYLOAD      — the compact partner shape from the Phase 4 spec
 *      (amount in major units, nested `error` object).
 */

const nonEmpty = z.string().trim().min(1);

// --- 1. Razorpay `payment.failed` webhook -----------------------------------

export const razorpayWebhookSchema = z.object({
  event: z.literal('payment.failed'),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: nonEmpty,
        // Razorpay sends the amount in the smallest currency unit (paise).
        amount: z.number().int().nonnegative(),
        currency: nonEmpty.default('INR'),
        method: nonEmpty,
        error_code: nonEmpty,
        error_reason: z.string().trim().min(1).nullish(),
        error_source: z.string().trim().min(1).nullish(),
        error_step: z.string().trim().min(1).nullish(),
        error_description: z.string().trim().min(1).nullish(),
        // Epoch seconds.
        created_at: z.number().int().positive().optional(),
      }),
    }),
  }),
});

// --- 2. Flat partner payload (Phase 4 spec) --------------------------------

export const flatFailureSchema = z.object({
  paymentId: nonEmpty,
  // Major currency units (e.g. rupees). Fractional values allowed.
  amount: z.number().positive(),
  currency: nonEmpty.default('INR'),
  method: nonEmpty,
  error: z.object({
    code: nonEmpty,
    reason: nonEmpty,
    source: nonEmpty,
    step: nonEmpty,
    description: nonEmpty,
  }),
  occurredAt: z.string().datetime().optional(),
});

export type RazorpayWebhookInput = z.infer<typeof razorpayWebhookSchema>;
export type FlatFailureInput = z.infer<typeof flatFailureSchema>;

export type ParsedFailurePayload =
  | { format: 'RAZORPAY_WEBHOOK'; data: RazorpayWebhookInput }
  | { format: 'FLAT_PAYLOAD'; data: FlatFailureInput };

export type PayloadParseResult =
  { ok: true; value: ParsedFailurePayload } | { ok: false; issues: z.ZodIssue[] };

/** Does this look like the Razorpay webhook envelope? */
function looksLikeWebhook(body: unknown): boolean {
  return typeof body === 'object' && body !== null && ('event' in body || 'payload' in body);
}

/**
 * Validate an incoming request body against whichever format it resembles.
 * The discriminator (`event`/`payload` key) is only used to pick the schema
 * that produces the clearest error messages — the chosen schema is still the
 * single source of truth for what is valid.
 */
export function parseFailurePayload(body: unknown): PayloadParseResult {
  if (looksLikeWebhook(body)) {
    const parsed = razorpayWebhookSchema.safeParse(body);
    return parsed.success
      ? { ok: true, value: { format: 'RAZORPAY_WEBHOOK', data: parsed.data } }
      : { ok: false, issues: parsed.error.issues };
  }

  const parsed = flatFailureSchema.safeParse(body);
  return parsed.success
    ? { ok: true, value: { format: 'FLAT_PAYLOAD', data: parsed.data } }
    : { ok: false, issues: parsed.error.issues };
}

// --- Idempotency-Key header --------------------------------------------------

const idempotencyKeySchema = z.string().trim().min(1).max(255);

export function parseIdempotencyKey(raw: unknown): { ok: true; key: string } | { ok: false } {
  const parsed = idempotencyKeySchema.safeParse(raw);
  return parsed.success ? { ok: true, key: parsed.data } : { ok: false };
}
