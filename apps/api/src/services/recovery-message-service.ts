import { Prisma, type RecoveryMessageSource, prismaClient, withTransaction } from '@recovery-desk/db';
import { type AIClient, type RecoveryMessageInput, type SupportedLanguage, generateRecoveryMessage } from '@recovery-desk/ai';

/**
 * Phase 12 §9 — the customer message service.
 *
 *   Recovery Decision -> sendMessage? -> build safe context -> AI generator
 *     -> validate -> fallback if needed -> persist -> audit
 *
 * `sendMessage` is the deterministic policy engine's call, already persisted
 * as `RecoveryAction.requiresCustomerMessage` at decide-time (Phase 12 §8) —
 * this service only checks that flag. It never decides to message a customer
 * on its own.
 */

export interface RecoveryMessageServiceDeps {
  client: AIClient | null;
}

export interface RecoveryMessageView {
  id: string;
  paymentId: string;
  recoveryActionId: string;
  channel: string;
  language: string;
  content: string;
  reason: string;
  source: RecoveryMessageSource;
  createdAt: string;
}

export type GenerateMessageResult =
  | { status: 'CREATED'; duplicate: false; message: RecoveryMessageView }
  | { status: 'DUPLICATE'; duplicate: true; message: RecoveryMessageView }
  | { status: 'ACTION_NOT_FOUND' }
  | { status: 'MESSAGE_NOT_REQUESTED' };

function toMinor(amount: Prisma.Decimal | string | number): number {
  return Math.round(Number(amount) * 100);
}

function resolveLanguage(preferred: string | null | undefined): SupportedLanguage {
  return preferred === 'HINGLISH' ? 'HINGLISH' : 'EN';
}

function view(row: {
  id: string;
  paymentId: string;
  recoveryActionId: string;
  channel: string;
  language: string;
  content: string;
  reason: string;
  source: RecoveryMessageSource;
  createdAt: Date;
}): RecoveryMessageView {
  return {
    id: row.id,
    paymentId: row.paymentId,
    recoveryActionId: row.recoveryActionId,
    channel: row.channel,
    language: row.language,
    content: row.content,
    reason: row.reason,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function generateAndPersistMessage(
  recoveryActionId: string,
  deps: RecoveryMessageServiceDeps,
): Promise<GenerateMessageResult> {
  const action = await prismaClient.recoveryAction.findUnique({
    where: { id: recoveryActionId },
    include: { payment: { include: { customer: true } }, message: true },
  });
  if (!action) return { status: 'ACTION_NOT_FOUND' };

  // Phase 12 §8 — policy: sendMessage=false -> AI is NOT called.
  if (!action.requiresCustomerMessage) {
    return { status: 'MESSAGE_NOT_REQUESTED' };
  }

  if (action.message) {
    return { status: 'DUPLICATE', duplicate: true, message: view(action.message) };
  }

  const idempotencyKey = `message:${recoveryActionId}`;
  const existingByKey = await prismaClient.recoveryMessage.findUnique({ where: { idempotencyKey } });
  if (existingByKey) {
    return { status: 'DUPLICATE', duplicate: true, message: view(existingByKey) };
  }

  const language = resolveLanguage(action.payment.customer.preferredLanguage);
  const input: RecoveryMessageInput = {
    paymentId: action.paymentId,
    amountMinor: toMinor(action.payment.amount),
    currency: action.payment.currency,
    paymentMethod: action.payment.method,
    rootCause: action.cause,
    recoveryAction: action.action,
    delayMinutes: action.delayMinutes,
    customerLanguage: language,
  };

  const result = await generateRecoveryMessage(input, { client: deps.client });

  try {
    const created = await withTransaction(async (tx) => {
      const row = await tx.recoveryMessage.create({
        data: {
          paymentId: action.paymentId,
          recoveryActionId,
          channel: 'SMS',
          language: result.value.language,
          content: result.value.message,
          reason: result.value.reason,
          source: result.source,
          idempotencyKey,
        },
      });

      await tx.auditEvent.create({
        data: {
          paymentId: action.paymentId,
          eventType: 'AI_OPERATION_COMPLETED',
          whatWeSaw: `Recovery action ${recoveryActionId} (${action.action}) requires a customer message (cause ${action.cause}).`,
          whatWeConcluded:
            result.source === 'AI'
              ? `Generated a ${result.value.language} message: ${result.value.reason}`
              : 'AI unavailable or returned invalid output; used the deterministic fallback template.',
          whatWasAllowed:
            'Generate wording only for an already-approved recovery action. No financial action, no ' +
            'retry, no schedule change.',
          whatWeDid: `Persisted recovery_message ${row.id} (source=${result.source}).`,
          whatHappened: 'Message recorded. Delivery to the customer happens outside Recovery Desk.',
          metadata: {
            operation: 'CUSTOMER_MESSAGE',
            model: result.model ?? null,
            source: result.source,
            messageId: row.id,
            usage: (result.usage ?? null) as Prisma.InputJsonValue | null,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return row;
    });

    return { status: 'CREATED', duplicate: false, message: view(created) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prismaClient.recoveryMessage.findUnique({ where: { idempotencyKey } });
      if (winner) return { status: 'DUPLICATE', duplicate: true, message: view(winner) };
    }
    throw err;
  }
}
