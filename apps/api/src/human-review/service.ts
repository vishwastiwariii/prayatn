import { Prisma, type RootCause, prismaClient, repositories, withTransaction } from '@recovery-desk/db';

/**
 * Phase 12 §17-19 — the human review workflow.
 *
 *   Unknown failure -> (optional) AI suggestion -> human reviewer
 *     -> ACCEPT (official classification, source=HUMAN)
 *     -> REJECT (a different cause, source=HUMAN)
 *     -> KEEP_UNKNOWN (stays UNKNOWN, source=HUMAN — an explicit, not a default, "we don't know")
 *
 * This module only ever appends a classification + audit event. It never
 * schedules or executes a recovery action — that stays the deterministic
 * policy engine's job via the existing `/decide` route, called separately
 * once a human (or nobody, if AI suggested nothing) has resolved this.
 */

const HUMAN_REVIEW_CLASSIFIER_VERSION = 'human-review-v1';

export interface PendingReviewItem {
  paymentId: string;
  amountMinor: number;
  currency: string;
  failureId: string;
  errorCode: string;
  errorReason: string;
  errorDescription: string;
  currentCause: RootCause;
  currentConfidence: number;
  aiSuggestion: {
    classificationId: string;
    cause: RootCause;
    confidence: number;
    explanation: string | null;
    createdAt: string;
  } | null;
  enteredReviewAt: string;
}

export type HumanReviewDecision = 'ACCEPT' | 'REJECT' | 'KEEP_UNKNOWN';

export interface ResolveReviewArgs {
  failureId: string;
  decision: HumanReviewDecision;
  rootCause?: RootCause;
  reason?: string;
}

export type ResolveReviewResult =
  | { status: 'RESOLVED'; duplicate: false; classificationId: string; cause: RootCause }
  | { status: 'DUPLICATE'; duplicate: true; classificationId: string; cause: RootCause }
  | { status: 'FAILURE_NOT_FOUND' }
  | { status: 'NOT_CLASSIFIED' }
  | { status: 'ROOT_CAUSE_REQUIRED' };

export interface HumanReviewService {
  listPending(): Promise<PendingReviewItem[]>;
  resolve(args: ResolveReviewArgs): Promise<ResolveReviewResult>;
}

function toMinor(amount: Prisma.Decimal | string | number): number {
  return Math.round(Number(amount) * 100);
}

export const liveHumanReviewService: HumanReviewService = {
  async listPending(): Promise<PendingReviewItem[]> {
    const payments = await prismaClient.payment.findMany({
      where: { recoveryStatus: 'HUMAN_REVIEW' },
      orderBy: { updatedAt: 'desc' },
      include: {
        failures: {
          orderBy: { occurredAt: 'desc' },
          take: 1,
          include: { classifications: { orderBy: { createdAt: 'desc' } } },
        },
      },
    });

    const items: PendingReviewItem[] = [];
    for (const p of payments) {
      const failure = p.failures[0];
      if (!failure) continue;
      // Already resolved by a human — payment.recoveryStatus stays
      // HUMAN_REVIEW as a historical marker, but it no longer belongs in the
      // pending queue.
      if (failure.classifications.some((c) => c.source === 'HUMAN')) continue;
      const ruleClassification =
        failure.classifications.find((c) => c.source === 'RULE') ?? failure.classifications[0];
      if (!ruleClassification) continue;
      const suggestion = failure.classifications.find((c) => c.source === 'LLM_SUGGESTION') ?? null;

      items.push({
        paymentId: p.id,
        amountMinor: toMinor(p.amount),
        currency: p.currency,
        failureId: failure.id,
        errorCode: failure.errorCode,
        errorReason: failure.errorReason,
        errorDescription: failure.errorDescription,
        currentCause: ruleClassification.cause,
        currentConfidence: ruleClassification.confidence,
        aiSuggestion: suggestion
          ? {
              classificationId: suggestion.id,
              cause: suggestion.cause,
              confidence: suggestion.confidence,
              explanation: suggestion.explanation,
              createdAt: suggestion.createdAt.toISOString(),
            }
          : null,
        enteredReviewAt: p.updatedAt.toISOString(),
      });
    }
    return items;
  },

  async resolve({ failureId, decision, rootCause, reason }): Promise<ResolveReviewResult> {
    const failure = await prismaClient.paymentFailure.findUnique({
      where: { id: failureId },
      include: { payment: true },
    });
    if (!failure) return { status: 'FAILURE_NOT_FOUND' };

    const classifications = await repositories.classifications.listByFailure(failureId);
    const ruleClassification =
      classifications.find((c) => c.source === 'RULE') ?? classifications[0] ?? null;
    if (!ruleClassification) return { status: 'NOT_CLASSIFIED' };
    const aiSuggestion = classifications.find((c) => c.source === 'LLM_SUGGESTION') ?? null;

    let finalCause: RootCause;
    if (decision === 'KEEP_UNKNOWN') {
      finalCause = 'UNKNOWN';
    } else {
      if (!rootCause) return { status: 'ROOT_CAUSE_REQUIRED' };
      finalCause = rootCause;
    }

    const existing = await prismaClient.classification.findUnique({
      where: {
        failureId_classifierVersion: { failureId, classifierVersion: HUMAN_REVIEW_CLASSIFIER_VERSION },
      },
    });
    if (existing) {
      return { status: 'DUPLICATE', duplicate: true, classificationId: existing.id, cause: existing.cause };
    }

    const created = await withTransaction(async (tx) => {
      const row = await tx.classification.create({
        data: {
          failureId,
          cause: finalCause,
          confidence: 1,
          ruleId: null,
          classifierVersion: HUMAN_REVIEW_CLASSIFIER_VERSION,
          source: 'HUMAN',
          evidence: [
            `human_decision=${decision}`,
            `rule_cause=${ruleClassification.cause}`,
            ...(aiSuggestion
              ? [`ai_suggested_cause=${aiSuggestion.cause}`, `ai_confidence=${aiSuggestion.confidence}`]
              : ['no_ai_suggestion']),
          ],
          explanation: reason ?? `Human reviewer decision: ${decision}.`,
        },
      });

      await tx.auditEvent.create({
        data: {
          paymentId: failure.paymentId,
          eventType: 'HUMAN_REVIEW_COMPLETED',
          whatWeSaw: aiSuggestion
            ? `Unknown payment failure (rule classification ${ruleClassification.cause}) with AI suggestion ` +
              `${aiSuggestion.cause} at ${Math.round(aiSuggestion.confidence * 100)}% confidence.`
            : `Unknown payment failure (rule classification ${ruleClassification.cause}); no AI suggestion was generated.`,
          whatWeConcluded: `Human reviewer decision: ${decision} -> ${finalCause}.`,
          whatWasAllowed:
            'Human reviewer may accept the AI suggestion, reject it for a different cause, or keep the ' +
            'failure UNKNOWN. This decision alone does not schedule or execute a recovery action.',
          whatWeDid: `Classification updated with source HUMAN (classification ${row.id}, cause ${finalCause}).`,
          whatHappened:
            finalCause === 'UNKNOWN'
              ? 'Failure remains UNKNOWN; no automated policy decision is possible.'
              : 'Failure is now eligible for normal policy evaluation via POST .../decide.',
          metadata: {
            classificationId: row.id,
            decision,
            ruleCause: ruleClassification.cause,
            aiSuggestedCause: aiSuggestion?.cause ?? null,
            aiConfidence: aiSuggestion?.confidence ?? null,
            finalCause,
            reason: reason ?? null,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return row;
    });

    return { status: 'RESOLVED', duplicate: false, classificationId: created.id, cause: created.cause };
  },
};
