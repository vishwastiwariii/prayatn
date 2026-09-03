import {
  type DecideRecoveryDeps,
  type EnqueueRecoveryDeps,
  type StoredAction,
  decideRecovery,
  enqueueRecoveryAction,
  liveDecideDeps,
  liveEnqueueDeps,
} from '@recovery-desk/recovery';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Phase 8 — the asynchronous recovery pipeline's HTTP edge.
 *
 *   POST /api/payments/failures/:failureId/decide     -> persist ONE approved RecoveryAction
 *   POST /api/recovery-actions/:actionId/enqueue      -> put it on the BullMQ queue
 *
 * These handlers only translate HTTP <-> service calls. All decision logic is
 * the policy engine; all queueing is `@recovery-desk/recovery`.
 */

function actionView(a: StoredAction) {
  return {
    actionId: a.id,
    paymentId: a.paymentId,
    cause: a.cause,
    action: a.action,
    status: a.status,
    attemptNumber: a.attemptNumber,
    scheduledFor: a.scheduledFor,
    delayMinutes: a.delayMinutes,
    maxAttempts: a.maxAttempts,
    reason: a.reason,
  };
}

export interface RecoveryRouteDeps {
  decide?: DecideRecoveryDeps;
  enqueue?: EnqueueRecoveryDeps;
}

export function createRecoveryRoutes(deps: RecoveryRouteDeps = {}): FastifyPluginAsync {
  const decideDeps = deps.decide ?? liveDecideDeps;
  const enqueueDeps = deps.enqueue ?? liveEnqueueDeps;

  return async (app) => {
    app.post<{ Params: { failureId: string } }>(
      '/api/payments/failures/:failureId/decide',
      async (request, reply) => {
        const { failureId } = request.params;
        const r = await decideRecovery(failureId, decideDeps);

        switch (r.status) {
          case 'DECIDED':
            return reply.code(201).send({
              status: 'DECIDED',
              duplicate: false,
              action: actionView(r.action),
              decision: {
                action: r.decision.action,
                intendedAction: r.decision.intendedAction,
                delayMinutes: r.decision.delayMinutes,
                nextEligibleAt: r.decision.nextEligibleAt,
                maxAttempts: r.decision.maxAttempts,
                attemptsRemaining: r.decision.attemptsRemaining,
                terminal: r.decision.terminal,
                permitted: r.decision.permitted,
                blockedBy: r.decision.blockedBy,
                playbookId: r.decision.playbookId,
                reason: r.decision.reason,
              },
            });
          case 'DUPLICATE':
            return reply.code(200).send({
              status: 'DUPLICATE',
              duplicate: true,
              action: actionView(r.action),
            });
          case 'FAILURE_NOT_FOUND':
            return reply
              .code(404)
              .send({
                status: 'FAILURE_NOT_FOUND',
                error: `No payment failure "${failureId}".`,
                failureId,
              });
          case 'NOT_CLASSIFIED':
            return reply.code(409).send({
              status: 'NOT_CLASSIFIED',
              error: `Failure "${failureId}" has no classification. POST .../classify first.`,
              failureId,
            });
        }
      },
    );

    app.post<{ Params: { actionId: string }; Body: { immediate?: boolean } | undefined }>(
      '/api/recovery-actions/:actionId/enqueue',
      async (request, reply) => {
        const { actionId } = request.params;
        const immediate = request.body?.immediate === true;
        const r = await enqueueRecoveryAction(actionId, enqueueDeps, { immediate });

        switch (r.status) {
          case 'ENQUEUED':
            return reply.code(202).send({
              status: 'ENQUEUED',
              jobId: r.jobId,
              delayMs: r.delayMs,
              scheduledFor: r.scheduledFor,
              action: actionView(r.action),
            });
          case 'DUPLICATE':
            return reply
              .code(200)
              .send({ status: 'DUPLICATE', jobId: r.jobId, action: actionView(r.action) });
          case 'NOT_FOUND':
            return reply
              .code(404)
              .send({ status: 'NOT_FOUND', error: `No recovery action "${actionId}".`, actionId });
          case 'NOT_ENQUEUEABLE':
            return reply.code(409).send({
              status: 'NOT_ENQUEUEABLE',
              error: r.reason,
              actionId,
              action: actionView(r.action),
            });
        }
      },
    );
  };
}
