import { Prisma, type ClassificationSource, prismaClient, withTransaction } from '@recovery-desk/db';
import { type AIClient, type FailureSuggestionInput, suggestFailureCause } from '@recovery-desk/ai';

/**
 * Phase 12 §13-16 — the unknown-failure suggestion service.
 *
 *   UNKNOWN / low-confidence failure -> sanitized context -> AI suggestion
 *     -> persisted as Classification(source=LLM_SUGGESTION)
 *
 * `LLM_SUGGESTION` is intentionally excluded from what the policy engine
 * treats as authoritative (`latestDecisionEligibleForFailure` only looks at
 * RULE/HUMAN) — persisting it here can never, by itself, cause a recovery
 * decision. A human must resolve it via `/api/human-review/:failureId/resolve`.
 */
const AI_SUGGESTION_CLASSIFIER_VERSION = 'ai-suggestion-v1';
/** "unknown/low-confidence" per Phase 12 §13 — UNKNOWN always qualifies too. */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface AISuggestionServiceDeps {
  client: AIClient | null;
}

export interface AISuggestionView {
  classificationId: string;
  failureId: string;
  suggestedRootCause: string;
  confidence: number;
  explanation: string | null;
  source: 'AI' | 'FALLBACK';
  createdAt: string;
}

export type GenerateSuggestionResult =
  | { status: 'CREATED'; duplicate: false; suggestion: AISuggestionView }
  | { status: 'DUPLICATE'; duplicate: true; suggestion: AISuggestionView }
  | { status: 'FAILURE_NOT_FOUND' }
  | { status: 'NOT_CLASSIFIED' }
  | { status: 'NOT_ELIGIBLE'; reason: string };

function toView(row: {
  id: string;
  failureId: string;
  cause: string;
  confidence: number;
  explanation: string | null;
  evidence: string[];
  createdAt: Date;
}): AISuggestionView {
  return {
    classificationId: row.id,
    failureId: row.failureId,
    suggestedRootCause: row.cause,
    confidence: row.confidence,
    explanation: row.explanation,
    // Recovered from the evidence recorded at generation time — whether the
    // model actually answered or this row is the deterministic fallback.
    source: row.evidence.includes('ai_source=FALLBACK') ? 'FALLBACK' : 'AI',
    createdAt: row.createdAt.toISOString(),
  };
}

const AUTHORITATIVE: ClassificationSource[] = ['RULE', 'HUMAN'];

export async function generateFailureSuggestion(
  failureId: string,
  deps: AISuggestionServiceDeps,
): Promise<GenerateSuggestionResult> {
  const failure = await prismaClient.paymentFailure.findUnique({
    where: { id: failureId },
    include: { payment: true, classifications: { orderBy: { createdAt: 'desc' } } },
  });
  if (!failure) return { status: 'FAILURE_NOT_FOUND' };

  const ruleClassification = failure.classifications.find((c) => AUTHORITATIVE.includes(c.source));
  if (!ruleClassification) return { status: 'NOT_CLASSIFIED' };

  const eligible = ruleClassification.cause === 'UNKNOWN' || ruleClassification.confidence < LOW_CONFIDENCE_THRESHOLD;
  if (!eligible) {
    return {
      status: 'NOT_ELIGIBLE',
      reason: `Current classification ${ruleClassification.cause} at ${Math.round(ruleClassification.confidence * 100)}% confidence does not need an AI suggestion.`,
    };
  }

  const existing = await prismaClient.classification.findUnique({
    where: {
      failureId_classifierVersion: { failureId, classifierVersion: AI_SUGGESTION_CLASSIFIER_VERSION },
    },
  });
  if (existing) {
    return { status: 'DUPLICATE', duplicate: true, suggestion: toView(existing) };
  }

  const input: FailureSuggestionInput = {
    errorCode: failure.errorCode,
    errorReason: failure.errorReason,
    errorSource: failure.errorSource,
    errorStep: failure.errorStep,
    errorDescription: failure.errorDescription,
    paymentMethod: failure.payment.method,
  };

  const result = await suggestFailureCause(input, { client: deps.client });

  const created = await withTransaction(async (tx) => {
    const row = await tx.classification.create({
      data: {
        failureId,
        cause: result.value.suggestedRootCause,
        confidence: result.value.confidence,
        ruleId: null,
        classifierVersion: AI_SUGGESTION_CLASSIFIER_VERSION,
        source: 'LLM_SUGGESTION',
        evidence: [
          `error_code=${input.errorCode}`,
          `error_reason=${input.errorReason}`,
          `error_source=${input.errorSource}`,
          `ai_source=${result.source}`,
        ],
        explanation: result.value.explanation,
      },
    });

    await tx.auditEvent.create({
      data: {
        paymentId: failure.paymentId,
        eventType: 'AI_OPERATION_COMPLETED',
        whatWeSaw: `Failure ${failureId} classified ${ruleClassification.cause} at ${Math.round(ruleClassification.confidence * 100)}% confidence — eligible for an AI suggestion.`,
        whatWeConcluded: `AI suggests ${result.value.suggestedRootCause} at ${Math.round(result.value.confidence * 100)}% confidence: ${result.value.explanation}`,
        whatWasAllowed:
          'Record a SUGGESTION only (source=LLM_SUGGESTION). This can never become the authoritative ' +
          'classification by itself and is excluded from what the policy engine reads.',
        whatWeDid: `Persisted classification ${row.id} (source=LLM_SUGGESTION).`,
        whatHappened: 'Awaiting human review via POST /api/human-review/:failureId/resolve.',
        metadata: {
          operation: 'FAILURE_SUGGESTION',
          model: result.model ?? null,
          source: result.source,
          classificationId: row.id,
          usage: (result.usage ?? null) as Prisma.InputJsonValue | null,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return row;
  });

  return { status: 'CREATED', duplicate: false, suggestion: toView(created) };
}
