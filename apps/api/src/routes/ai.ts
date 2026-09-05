import type { FastifyPluginAsync } from 'fastify';
import { getLiveAIClient } from '../ai/deps';
import { type GenerateSuggestionResult, generateFailureSuggestion } from '../services/ai-suggestion-service';
import { type GenerateExplanationResult, generateExplanation } from '../services/merchant-explanation-service';
import { type GenerateMessageResult, generateAndPersistMessage } from '../services/recovery-message-service';

/**
 * Phase 12 §23 — the three AI-assisted endpoints. Every one of them wraps a
 * generator from `@recovery-desk/ai` that can never throw its way into a 500
 * for a "the AI is down" reason — see each service's docstring.
 *
 * Each operation is injected as a plain async function (not a raw AI client)
 * so routes stay testable with `app.inject` and no database or network call,
 * matching the rest of the app's DI convention.
 */
export interface AIRouteDeps {
  generateMessage?: (recoveryActionId: string) => Promise<GenerateMessageResult>;
  generateSuggestion?: (failureId: string) => Promise<GenerateSuggestionResult>;
  generateExplanation?: (recoveryActionId: string) => Promise<GenerateExplanationResult>;
}

export function createAIRoutes(deps: AIRouteDeps = {}): FastifyPluginAsync {
  const generateMessage =
    deps.generateMessage ??
    ((recoveryActionId: string) => generateAndPersistMessage(recoveryActionId, { client: getLiveAIClient() }));
  const generateSuggestion =
    deps.generateSuggestion ??
    ((failureId: string) => generateFailureSuggestion(failureId, { client: getLiveAIClient() }));
  const generateExplanationFn =
    deps.generateExplanation ??
    ((recoveryActionId: string) => generateExplanation(recoveryActionId, { client: getLiveAIClient() }));

  return async (app) => {
    app.post<{ Params: { recoveryActionId: string } }>(
      '/api/recovery-actions/:recoveryActionId/message',
      async (request, reply) => {
        const { recoveryActionId } = request.params;
        const result = await generateMessage(recoveryActionId);

        switch (result.status) {
          case 'CREATED':
            return reply.code(201).send({ status: 'CREATED', duplicate: false, message: result.message });
          case 'DUPLICATE':
            return reply.code(200).send({ status: 'DUPLICATE', duplicate: true, message: result.message });
          case 'ACTION_NOT_FOUND':
            return reply
              .code(404)
              .send({ status: 'ACTION_NOT_FOUND', error: `No recovery action "${recoveryActionId}".` });
          case 'MESSAGE_NOT_REQUESTED':
            return reply.code(409).send({
              status: 'MESSAGE_NOT_REQUESTED',
              error:
                'The policy decision for this recovery action did not request a customer message ' +
                '(requiresCustomerMessage=false) — AI is not called.',
            });
        }
      },
    );

    app.post<{ Params: { failureId: string } }>(
      '/api/payments/failures/:failureId/ai-suggestion',
      async (request, reply) => {
        const { failureId } = request.params;
        const result = await generateSuggestion(failureId);

        switch (result.status) {
          case 'CREATED':
            return reply
              .code(201)
              .send({ status: 'CREATED', duplicate: false, suggestion: result.suggestion });
          case 'DUPLICATE':
            return reply
              .code(200)
              .send({ status: 'DUPLICATE', duplicate: true, suggestion: result.suggestion });
          case 'FAILURE_NOT_FOUND':
            return reply
              .code(404)
              .send({ status: 'FAILURE_NOT_FOUND', error: `No payment failure "${failureId}".` });
          case 'NOT_CLASSIFIED':
            return reply.code(409).send({
              status: 'NOT_CLASSIFIED',
              error: `Failure "${failureId}" has no classification yet.`,
            });
          case 'NOT_ELIGIBLE':
            return reply.code(409).send({ status: 'NOT_ELIGIBLE', error: result.reason });
        }
      },
    );

    app.post<{ Params: { recoveryActionId: string } }>(
      '/api/recovery-actions/:recoveryActionId/explanation',
      async (request, reply) => {
        const { recoveryActionId } = request.params;
        const result = await generateExplanationFn(recoveryActionId);

        if (result.status === 'ACTION_NOT_FOUND') {
          return reply
            .code(404)
            .send({ status: 'ACTION_NOT_FOUND', error: `No recovery action "${recoveryActionId}".` });
        }
        return reply
          .code(200)
          .send({ status: 'OK', source: result.source, explanation: result.explanation });
      },
    );
  };
}
