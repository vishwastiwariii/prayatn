import {
  Prisma,
  type PaymentMethod,
  type RecoveryActionType,
  type RecoveryStatus,
  type RootCause,
  prismaClient,
} from '@recovery-desk/db';

/**
 * Read services behind the Payment Explorer / Payment Detail screens
 * (Phase 11 §13, §14). These only read — Human Review lives in
 * `../human-review/service.ts` (Phase 12), and message/explanation/suggestion
 * generation live in `../services/*` (Phase 12).
 */

export interface PaymentListFilters {
  status?: RecoveryStatus;
  cause?: RootCause;
  method?: PaymentMethod;
  action?: RecoveryActionType;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentListItem {
  paymentId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  status: string;
  recoveryStatus: RecoveryStatus | null;
  attemptCount: number;
  cause: RootCause | null;
  confidence: number | null;
  action: RecoveryActionType | null;
  actionStatus: string | null;
  maxAttempts: number | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentListResult {
  items: PaymentListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaymentDetail {
  payment: {
    id: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod;
    status: string;
    recoveryStatus: RecoveryStatus | null;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
  };
  customer: { id: string; name: string; balanceState: string; salaryDay: number | null } | null;
  failures: Array<{
    id: string;
    errorCode: string;
    errorReason: string;
    errorSource: string;
    errorStep: string;
    errorDescription: string;
    occurredAt: string;
    classifications: Array<{
      id: string;
      cause: RootCause;
      confidence: number;
      ruleId: string | null;
      source: string;
      evidence: string[];
      explanation: string | null;
      createdAt: string;
    }>;
  }>;
  recoveryActions: Array<{
    id: string;
    cause: RootCause;
    action: RecoveryActionType;
    status: string;
    attemptNumber: number;
    scheduledFor: string | null;
    reason: string | null;
    delayMinutes: number | null;
    maxAttempts: number | null;
    requiresCustomerMessage: boolean;
    createdAt: string;
    executedAt: string | null;
    outcome: {
      status: string;
      amountRecoveredMinor: number;
      gatewayLatencyMs: number | null;
      failureReason: string | null;
      occurredAt: string;
    } | null;
  }>;
  messages: Array<{
    id: string;
    recoveryActionId: string;
    channel: string;
    language: string;
    content: string;
    reason: string;
    source: 'AI' | 'FALLBACK';
    createdAt: string;
  }>;
  auditTimeline: Array<{
    id: string;
    eventType: string;
    whatWeSaw: string;
    whatWeConcluded: string;
    whatWasAllowed: string;
    whatWeDid: string;
    whatHappened: string;
    createdAt: string;
  }>;
}

export interface PaymentsReader {
  list(filters: PaymentListFilters): Promise<PaymentListResult>;
  detail(paymentId: string): Promise<PaymentDetail | null>;
}

function toMinor(amount: Prisma.Decimal | string | number): number {
  return Math.round(Number(amount) * 100);
}

export const livePaymentsReader: PaymentsReader = {
  async list(filters): Promise<PaymentListResult> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    const where: Prisma.PaymentWhereInput = {
      ...(filters.status ? { recoveryStatus: filters.status } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.cause
        ? { failures: { some: { classifications: { some: { cause: filters.cause } } } } }
        : {}),
      ...(filters.action ? { recoveryActions: { some: { action: filters.action } } } : {}),
      ...(filters.q ? { id: { contains: filters.q, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      prismaClient.payment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          failures: {
            orderBy: { occurredAt: 'desc' },
            take: 1,
            include: { classifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
          recoveryActions: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      prismaClient.payment.count({ where }),
    ]);

    const items: PaymentListItem[] = rows.map((p) => {
      const cls = p.failures[0]?.classifications[0] ?? null;
      const act = p.recoveryActions[0] ?? null;
      return {
        paymentId: p.id,
        amountMinor: toMinor(p.amount),
        currency: p.currency,
        method: p.method,
        status: p.status,
        recoveryStatus: p.recoveryStatus,
        attemptCount: p.attemptCount,
        cause: cls?.cause ?? null,
        confidence: cls?.confidence ?? null,
        action: act?.action ?? null,
        actionStatus: act?.status ?? null,
        maxAttempts: act?.maxAttempts ?? null,
        scheduledFor: act?.scheduledFor?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return { items, total, limit, offset };
  },

  async detail(paymentId): Promise<PaymentDetail | null> {
    const p = await prismaClient.payment.findUnique({
      where: { id: paymentId },
      include: {
        customer: true,
        failures: {
          orderBy: { occurredAt: 'desc' },
          include: { classifications: { orderBy: { createdAt: 'desc' } } },
        },
        recoveryActions: { orderBy: { createdAt: 'desc' }, include: { outcome: true } },
        messages: { orderBy: { createdAt: 'desc' } },
        auditEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) return null;

    return {
      payment: {
        id: p.id,
        amountMinor: toMinor(p.amount),
        currency: p.currency,
        method: p.method,
        status: p.status,
        recoveryStatus: p.recoveryStatus,
        attemptCount: p.attemptCount,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      },
      customer: p.customer
        ? {
            id: p.customer.id,
            name: p.customer.name,
            balanceState: p.customer.balanceState,
            salaryDay: p.customer.salaryDay,
          }
        : null,
      failures: p.failures.map((f) => ({
        id: f.id,
        errorCode: f.errorCode,
        errorReason: f.errorReason,
        errorSource: f.errorSource,
        errorStep: f.errorStep,
        errorDescription: f.errorDescription,
        occurredAt: f.occurredAt.toISOString(),
        classifications: f.classifications.map((c) => ({
          id: c.id,
          cause: c.cause,
          confidence: c.confidence,
          ruleId: c.ruleId,
          source: c.source,
          evidence: c.evidence,
          explanation: c.explanation,
          createdAt: c.createdAt.toISOString(),
        })),
      })),
      recoveryActions: p.recoveryActions.map((a) => ({
        id: a.id,
        cause: a.cause,
        action: a.action,
        status: a.status,
        attemptNumber: a.attemptNumber,
        scheduledFor: a.scheduledFor?.toISOString() ?? null,
        reason: a.reason,
        delayMinutes: a.delayMinutes,
        maxAttempts: a.maxAttempts,
        requiresCustomerMessage: a.requiresCustomerMessage,
        createdAt: a.createdAt.toISOString(),
        executedAt: a.executedAt?.toISOString() ?? null,
        outcome: a.outcome
          ? {
              status: a.outcome.status,
              amountRecoveredMinor: toMinor(a.outcome.amountRecovered),
              gatewayLatencyMs: a.outcome.gatewayLatencyMs,
              failureReason: a.outcome.failureReason,
              occurredAt: a.outcome.occurredAt.toISOString(),
            }
          : null,
      })),
      messages: p.messages.map((m) => ({
        id: m.id,
        recoveryActionId: m.recoveryActionId,
        channel: m.channel,
        language: m.language,
        content: m.content,
        reason: m.reason,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      })),
      auditTimeline: p.auditEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        whatWeSaw: e.whatWeSaw,
        whatWeConcluded: e.whatWeConcluded,
        whatWasAllowed: e.whatWasAllowed,
        whatWeDid: e.whatWeDid,
        whatHappened: e.whatHappened,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  },
};
