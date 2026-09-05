import { Prisma, prismaClient } from '@recovery-desk/db';
import {
  type AIClient,
  type MerchantExplanation,
  type MerchantExplanationInput,
  generateMerchantExplanation,
} from '@recovery-desk/ai';

/**
 * Phase 12 §11-12 — the merchant explanation service. Stateless (nothing is
 * persisted beyond the audit trail): the Decision Inspector calls this
 * on demand, and it always has a working answer, AI or not.
 */
export interface MerchantExplanationServiceDeps {
  client: AIClient | null;
}

export interface MerchantExplanationResult {
  status: 'OK';
  explanation: MerchantExplanation;
  source: 'AI' | 'FALLBACK';
}

export type GenerateExplanationResult = MerchantExplanationResult | { status: 'ACTION_NOT_FOUND' };

export async function generateExplanation(
  recoveryActionId: string,
  deps: MerchantExplanationServiceDeps,
): Promise<GenerateExplanationResult> {
  const action = await prismaClient.recoveryAction.findUnique({
    where: { id: recoveryActionId },
    include: { payment: true },
  });
  if (!action) return { status: 'ACTION_NOT_FOUND' };

  const classification = await prismaClient.classification.findFirst({
    where: {
      cause: action.cause,
      source: { in: ['RULE', 'HUMAN'] },
      failure: { paymentId: action.paymentId },
    },
    orderBy: { createdAt: 'desc' },
  });

  const input: MerchantExplanationInput = {
    paymentMethod: action.payment.method,
    rootCause: action.cause,
    confidence: classification?.confidence ?? 0,
    recoveryAction: action.action,
    reason: action.reason ?? `${action.action} for ${action.cause}.`,
    attempts: action.attemptNumber,
    maxAttempts: action.maxAttempts,
  };

  const result = await generateMerchantExplanation(input, { client: deps.client });

  await prismaClient.auditEvent.create({
    data: {
      paymentId: action.paymentId,
      eventType: 'AI_OPERATION_COMPLETED',
      whatWeSaw: `Merchant requested an explanation for recovery action ${recoveryActionId} (${action.action}).`,
      whatWeConcluded:
        result.source === 'AI'
          ? `Generated explanation: ${result.value.summary}`
          : 'AI unavailable or returned invalid output; used policy.reason verbatim.',
      whatWasAllowed:
        'Explain the already-made decision in plain English. May not reinterpret or contradict it.',
      whatWeDid: `Returned a ${result.source} explanation (not persisted).`,
      whatHappened: 'Displayed on the Decision Inspector.',
      metadata: {
        operation: 'MERCHANT_EXPLANATION',
        model: result.model ?? null,
        source: result.source,
        usage: (result.usage ?? null) as Prisma.InputJsonValue | null,
      } satisfies Prisma.InputJsonObject,
    },
  });

  return { status: 'OK', explanation: result.value, source: result.source };
}
