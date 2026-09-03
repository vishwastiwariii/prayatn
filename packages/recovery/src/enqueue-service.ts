import { SCHEDULABLE_ACTIONS } from './types';
import type { EnqueueRecoveryDeps, EnqueueRecoveryResult } from './types';

/**
 * `POST /enqueue` core.
 *
 *   load(RecoveryAction) -> validate it is a fresh, schedulable, approved action
 *     -> BullMQ add (jobId = actionId, delay = time until scheduledFor)
 *     -> mark action SCHEDULED + audit
 *
 * It does NOT decide anything. If the action is terminal (HARD_STOP /
 * HUMAN_REVIEW) or already running/done, it refuses. Re-enqueue of an already
 * scheduled action is a no-op (BullMQ dedupes on jobId; we report DUPLICATE).
 */

export interface EnqueueOptions {
  /** Ignore `scheduledFor` and run as soon as possible (demos, load tests). */
  immediate?: boolean;
}

export async function enqueueRecoveryAction(
  actionId: string,
  deps: EnqueueRecoveryDeps,
  opts: EnqueueOptions = {},
): Promise<EnqueueRecoveryResult> {
  const action = await deps.loadAction(actionId);
  if (!action) return { status: 'NOT_FOUND', actionId };

  if (!SCHEDULABLE_ACTIONS.has(action.action)) {
    return {
      status: 'NOT_ENQUEUEABLE',
      actionId,
      reason: `Action ${action.action} is terminal and is never queued.`,
      action,
    };
  }

  switch (action.status) {
    case 'PENDING':
      break;
    case 'SCHEDULED':
    case 'EXECUTING':
    case 'EXECUTED':
      return { status: 'DUPLICATE', jobId: action.id, action };
    default:
      return {
        status: 'NOT_ENQUEUEABLE',
        actionId,
        reason: `Action status ${action.status} cannot be queued.`,
        action,
      };
  }

  const now = deps.now();
  const delayMs = opts.immediate
    ? 0
    : Math.max(0, (action.scheduledFor?.getTime() ?? now.getTime()) - now.getTime());

  const { jobId } = await deps.enqueue(
    {
      actionId: action.id,
      paymentId: action.paymentId,
      attemptNumber: action.attemptNumber,
      enqueuedAt: now.toISOString(),
    },
    delayMs,
  );

  const updated = await deps.markScheduled(action.id, jobId, delayMs);
  return {
    status: 'ENQUEUED',
    jobId,
    delayMs,
    scheduledFor: updated.scheduledFor,
    action: updated,
  };
}
