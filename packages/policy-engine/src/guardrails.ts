import { addMinutes, isWithinQuietHours, nextHourBoundary } from './time';
import type {
  IntendedDecision,
  PermissionSet,
  Playbook,
  PolicyContext,
  PolicyDecision,
  RecoveryAction,
} from './types';

/**
 * Guardrails — the "what is permitted" half.
 *
 * Applied on top of EVERY playbook, in a fixed order. Each guardrail can only
 * make the outcome MORE restrictive (stop it, defer it, or escalate it to a
 * human); none can loosen a playbook. The order is deliberate:
 *
 *   1. kill_switch_engaged        hard stop, nothing else matters
 *   2. mandate_revoked            hard stop, cancel everything
 *   3. payment_already_resolved   nothing left to recover
 *   4. playbook_terminal          HARD_STOP / structural stops lock permissions
 *   5. classification_low_confidence   don't act on a shaky diagnosis -> human
 *   6. attempt_limit_reached      automated attempts exhausted -> human
 *   7. circuit_breaker_open       force WAIT behind the breaker cooldown
 *   8. message_daily_limit_reached  defer the message to tomorrow
 *   9. quiet_hours                defer the message to the next allowed hour
 */

const RETRYING_ACTIONS: ReadonlySet<RecoveryAction> = new Set<RecoveryAction>([
  'RETRY',
  'WAIT',
  'SWITCH_RAIL',
]);

function basePermissions(action: RecoveryAction): PermissionSet {
  switch (action) {
    case 'RETRY':
      return {
        retry: true,
        scheduleRetry: true,
        switchRail: false,
        messageCustomer: false,
        autoExecute: true,
      };
    case 'WAIT':
      return {
        retry: false,
        scheduleRetry: true,
        switchRail: false,
        messageCustomer: false,
        autoExecute: true,
      };
    case 'SWITCH_RAIL':
      return {
        retry: false,
        scheduleRetry: true,
        switchRail: true,
        messageCustomer: true,
        autoExecute: true,
      };
    case 'MESSAGE':
      return {
        retry: false,
        scheduleRetry: false,
        switchRail: false,
        messageCustomer: true,
        autoExecute: true,
      };
    case 'HARD_STOP':
      return {
        retry: false,
        scheduleRetry: false,
        switchRail: false,
        messageCustomer: false,
        autoExecute: true,
      };
    case 'HUMAN_REVIEW':
      return {
        retry: false,
        scheduleRetry: false,
        switchRail: false,
        messageCustomer: false,
        autoExecute: false,
      };
  }
}

interface Working {
  action: RecoveryAction;
  delayMinutes: number | null;
  nextEligibleAt: Date | null;
  terminal: boolean;
  permitted: PermissionSet;
  blockedBy: string[];
  constraintsApplied: string[];
  requiresCustomerMessage: boolean;
  requiresHumanReview: boolean;
  reasonSuffix: string[];
}

function finalize(
  playbook: Playbook,
  intended: IntendedDecision,
  ctx: PolicyContext,
  w: Working,
  attemptsRemaining: number,
  maxAttempts: number,
): PolicyDecision {
  const reason =
    w.reasonSuffix.length > 0 ? `${intended.reason} ${w.reasonSuffix.join(' ')}` : intended.reason;
  return {
    cause: ctx.classification.cause,
    playbookId: playbook.id,
    intendedAction: intended.action,
    action: w.action,
    delayMinutes: w.delayMinutes,
    nextEligibleAt: w.nextEligibleAt,
    maxAttempts,
    attemptsRemaining,
    terminal: w.terminal,
    permitted: w.permitted,
    blockedBy: w.blockedBy,
    constraintsApplied: w.constraintsApplied,
    requiresCustomerMessage: w.requiresCustomerMessage,
    requiresHumanReview: w.requiresHumanReview,
    reason,
    evidence: intended.evidence ?? [`cause=${ctx.classification.cause}`],
  };
}

/** A permanent stop, permissions all locked. Used by guardrails 1-3. */
function hardStop(
  playbook: Playbook,
  intended: IntendedDecision,
  ctx: PolicyContext,
  guardrailId: string,
  reasonSuffix: string,
): PolicyDecision {
  return {
    cause: ctx.classification.cause,
    playbookId: playbook.id,
    intendedAction: intended.action,
    action: 'HARD_STOP',
    delayMinutes: null,
    nextEligibleAt: null,
    maxAttempts: 0,
    attemptsRemaining: 0,
    terminal: true,
    permitted: basePermissions('HARD_STOP'),
    blockedBy: [guardrailId],
    constraintsApplied: [guardrailId],
    requiresCustomerMessage: false,
    requiresHumanReview: false,
    reason: `${intended.reason} ${reasonSuffix}`,
    evidence: [...(intended.evidence ?? []), `guardrail=${guardrailId}`],
  };
}

export function applyGuardrails(
  playbook: Playbook,
  intended: IntendedDecision,
  ctx: PolicyContext,
): PolicyDecision {
  const { constraints, history, payment, classification } = ctx;

  // 1-3: unconditional permanent stops — short-circuit.
  if (constraints.killSwitchEngaged) {
    return hardStop(
      playbook,
      intended,
      ctx,
      'kill_switch_engaged',
      'Global kill switch is engaged: all recovery is halted.',
    );
  }
  if (history.mandateRevoked) {
    return hardStop(
      playbook,
      intended,
      ctx,
      'mandate_revoked',
      'Mandate has been revoked: cancel every scheduled and future retry.',
    );
  }
  if (payment.status === 'SUCCEEDED' || payment.status === 'HARD_STOPPED') {
    return hardStop(
      playbook,
      intended,
      ctx,
      'payment_already_resolved',
      `Payment is already ${payment.status}: nothing to recover.`,
    );
  }

  const maxAttempts = Math.min(intended.maxAttempts, constraints.maxAttempts);
  const attemptsRemaining = Math.max(0, maxAttempts - payment.attemptCount);

  const w: Working = {
    action: intended.action,
    delayMinutes: intended.delayMinutes,
    nextEligibleAt: null,
    terminal: intended.terminal ?? false,
    permitted: basePermissions(intended.action),
    blockedBy: [],
    constraintsApplied: [],
    requiresCustomerMessage: intended.requiresCustomerMessage ?? false,
    requiresHumanReview: intended.requiresHumanReview ?? false,
    reasonSuffix: [],
  };

  // 4: playbook is itself terminal (HARD_STOP).
  if (w.action === 'HARD_STOP') {
    w.terminal = true;
    w.delayMinutes = null;
    return finalize(playbook, intended, ctx, w, 0, maxAttempts);
  }

  // 5: low-confidence classification -> don't act on it, escalate.
  if (
    w.action !== 'HUMAN_REVIEW' &&
    classification.confidence < constraints.minClassificationConfidence
  ) {
    w.action = 'HUMAN_REVIEW';
    w.permitted = basePermissions('HUMAN_REVIEW');
    w.requiresHumanReview = true;
    w.blockedBy.push('classification_low_confidence');
    w.constraintsApplied.push('classification_low_confidence');
    w.delayMinutes = null;
    w.reasonSuffix.push(
      `Classification confidence ${classification.confidence.toFixed(2)} is below the ` +
        `${constraints.minClassificationConfidence} threshold, so a human must confirm before any action.`,
    );
    return finalize(playbook, intended, ctx, w, attemptsRemaining, maxAttempts);
  }

  // 6: automated attempts exhausted.
  if (RETRYING_ACTIONS.has(w.action) && attemptsRemaining <= 0) {
    w.action = 'HUMAN_REVIEW';
    w.permitted = basePermissions('HUMAN_REVIEW');
    w.requiresHumanReview = true;
    w.blockedBy.push('attempt_limit_reached');
    w.constraintsApplied.push('attempt_limit_reached');
    w.delayMinutes = null;
    w.reasonSuffix.push(
      `Attempt limit reached (${payment.attemptCount}/${maxAttempts}): automated retries are exhausted, escalating to human review.`,
    );
    return finalize(playbook, intended, ctx, w, 0, maxAttempts);
  }

  // 7: circuit breaker open -> force WAIT behind the cooldown.
  if ((w.action === 'RETRY' || w.action === 'WAIT') && constraints.circuitBreaker === 'OPEN') {
    w.action = 'WAIT';
    w.permitted = basePermissions('WAIT');
    w.delayMinutes = Math.max(w.delayMinutes ?? 0, constraints.circuitCooldownMinutes);
    w.blockedBy.push('circuit_breaker_open');
    w.constraintsApplied.push('circuit_breaker_open');
    w.reasonSuffix.push(
      `Circuit breaker is OPEN: holding for at least the ${constraints.circuitCooldownMinutes}-minute cooldown before any retry.`,
    );
  } else if (
    (w.action === 'RETRY' || w.action === 'WAIT') &&
    constraints.circuitBreaker === 'HALF_OPEN'
  ) {
    w.constraintsApplied.push('circuit_breaker_half_open');
    w.reasonSuffix.push('Circuit breaker is HALF_OPEN: this retry doubles as a probe.');
  }

  // 8: customer contact ceiling -> defer the message.
  if (w.action === 'MESSAGE' && history.messagesSentInWindow >= constraints.maxMessagesPerDay) {
    w.action = 'WAIT';
    w.permitted = basePermissions('WAIT');
    w.permitted.messageCustomer = false;
    w.requiresCustomerMessage = true; // still needed, just not now
    w.nextEligibleAt = nextHourBoundary(constraints.now, constraints.quietHoursEnd);
    w.delayMinutes = Math.max(
      0,
      Math.ceil((w.nextEligibleAt.getTime() - constraints.now.getTime()) / 60_000),
    );
    w.blockedBy.push('message_daily_limit_reached');
    w.constraintsApplied.push('message_daily_limit_reached');
    w.reasonSuffix.push(
      `Customer already received ${history.messagesSentInWindow}/${constraints.maxMessagesPerDay} messages in the last 24h: defer the next contact.`,
    );
  }

  // 9: quiet hours -> defer the message (do not cancel it).
  if (
    w.action === 'MESSAGE' &&
    isWithinQuietHours(constraints.now, constraints.quietHoursStart, constraints.quietHoursEnd)
  ) {
    w.nextEligibleAt = nextHourBoundary(constraints.now, constraints.quietHoursEnd);
    w.delayMinutes = Math.max(
      0,
      Math.ceil((w.nextEligibleAt.getTime() - constraints.now.getTime()) / 60_000),
    );
    w.blockedBy.push('quiet_hours');
    w.constraintsApplied.push('quiet_hours');
    w.reasonSuffix.push(
      `Inside quiet hours (${constraints.quietHoursStart}:00-${constraints.quietHoursEnd}:00): send at ${w.nextEligibleAt.toISOString()}.`,
    );
  }

  // 10: default nextEligibleAt from the delay, if a guardrail hasn't set one.
  if (w.nextEligibleAt === null) {
    if (w.action === 'MESSAGE') {
      w.nextEligibleAt = constraints.now; // send now
    } else if (w.delayMinutes !== null && RETRYING_ACTIONS.has(w.action)) {
      w.nextEligibleAt = addMinutes(constraints.now, w.delayMinutes);
    }
  }

  return finalize(playbook, intended, ctx, w, attemptsRemaining, maxAttempts);
}
