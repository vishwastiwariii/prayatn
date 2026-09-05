import { COST_PER_ATTEMPT_MINOR, COST_PER_MESSAGE_MINOR } from '@recovery-desk/experiment';
import { prismaClient, type RecoveryActionType, type RootCause } from '@recovery-desk/db';
import { liveHumanReviewService } from '../human-review/service';

/**
 * Dashboard aggregation — Phase 11 §25.
 *
 * Everything here reads the LIVE Postgres state (real ingested failures, real
 * classifications, real policy decisions, real outcomes). It answers "what is
 * actually happening in the recovery pipeline right now", as opposed to
 * `@recovery-desk/experiment`'s evaluation engine, which answers "how would
 * Recovery Desk compare to naive retries on the same frozen dataset".
 *
 * All aggregation happens here (groupBy / count), never in the frontend.
 */

export interface RootCauseCount {
  cause: RootCause;
  count: number;
  pct: number;
}

export interface ActionCount {
  action: RecoveryActionType;
  count: number;
  pct: number;
}

export interface ActivityItem {
  id: string;
  createdAt: string;
  paymentId: string | null;
  eventType: string;
  whatWeConcluded: string;
  whatWeDid: string;
}

export interface DashboardSummary {
  funnel: {
    initiallyFailed: number;
    classified: number;
    eligible: number;
    attempted: number;
    recovered: number;
  };
  recovery: {
    amountRecoveredMinor: number;
    attemptsConsumed: number;
    messagesSent: number;
    hardStops: number;
    humanReview: number;
    costPerRecoveryMinor: number | null;
  };
  rootCauses: RootCauseCount[];
  actions: ActionCount[];
  recentActivity: ActivityItem[];
  costModel: { perAttemptMinor: number; perMessageMinor: number };
}

export interface DashboardReader {
  getSummary(): Promise<DashboardSummary>;
}

/** Actions the policy engine can actually schedule/execute automatically. */
const ELIGIBLE_ACTIONS: RecoveryActionType[] = ['RETRY', 'WAIT', 'MESSAGE', 'SWITCH_RAIL'];

function pctOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export const liveDashboardReader: DashboardReader = {
  async getSummary(): Promise<DashboardSummary> {
    const [
      initiallyFailed,
      classifiedRows,
      eligiblePayments,
      attemptedPayments,
      recoveredCount,
      amountAgg,
      attemptsConsumed,
      messagesSent,
      hardStops,
      pendingReviews,
      rootCauseGroups,
      actionGroups,
      recentAudit,
    ] = await Promise.all([
      prismaClient.paymentFailure.count(),
      prismaClient.classification.groupBy({ by: ['cause'], _count: { _all: true } }),
      prismaClient.recoveryAction.findMany({
        where: { action: { in: ELIGIBLE_ACTIONS } },
        select: { paymentId: true },
        distinct: ['paymentId'],
      }),
      prismaClient.recoveryAction.findMany({
        where: { outcome: { isNot: null } },
        select: { paymentId: true },
        distinct: ['paymentId'],
      }),
      prismaClient.payment.count({ where: { status: 'SUCCEEDED' } }),
      prismaClient.recoveryOutcome.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amountRecovered: true },
      }),
      prismaClient.recoveryOutcome.count(),
      prismaClient.recoveryAction.count({ where: { action: 'MESSAGE', status: 'EXECUTED' } }),
      prismaClient.recoveryAction.count({ where: { action: 'HARD_STOP' } }),
      // Same definition as GET /api/human-review — excludes failures a human
      // has already resolved, even though `payment.recoveryStatus` stays
      // HUMAN_REVIEW forever as a historical marker.
      liveHumanReviewService.listPending(),
      prismaClient.classification.groupBy({ by: ['cause'], _count: { _all: true } }),
      prismaClient.recoveryAction.groupBy({ by: ['action'], _count: { _all: true } }),
      prismaClient.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    const classified = classifiedRows.reduce((sum, r) => sum + r._count._all, 0);
    const totalRootCause = rootCauseGroups.reduce((sum, r) => sum + r._count._all, 0);
    const totalActions = actionGroups.reduce((sum, r) => sum + r._count._all, 0);
    const amountRecoveredMinor = Math.round(Number(amountAgg._sum.amountRecovered ?? 0) * 100);
    const costMinor = attemptsConsumed * COST_PER_ATTEMPT_MINOR + messagesSent * COST_PER_MESSAGE_MINOR;

    return {
      funnel: {
        initiallyFailed,
        classified,
        eligible: eligiblePayments.length,
        attempted: attemptedPayments.length,
        recovered: recoveredCount,
      },
      recovery: {
        amountRecoveredMinor,
        attemptsConsumed,
        messagesSent,
        hardStops,
        humanReview: pendingReviews.length,
        costPerRecoveryMinor: recoveredCount > 0 ? Math.round(costMinor / recoveredCount) : null,
      },
      rootCauses: rootCauseGroups
        .map((r) => ({ cause: r.cause, count: r._count._all, pct: pctOf(r._count._all, totalRootCause) }))
        .sort((a, b) => b.count - a.count),
      actions: actionGroups
        .map((r) => ({ action: r.action, count: r._count._all, pct: pctOf(r._count._all, totalActions) }))
        .sort((a, b) => b.count - a.count),
      recentActivity: recentAudit.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        paymentId: e.paymentId,
        eventType: e.eventType,
        whatWeConcluded: e.whatWeConcluded,
        whatWeDid: e.whatWeDid,
      })),
      costModel: { perAttemptMinor: COST_PER_ATTEMPT_MINOR, perMessageMinor: COST_PER_MESSAGE_MINOR },
    };
  },
};
