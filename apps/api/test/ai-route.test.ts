import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { GenerateMessageResult } from '../src/services/recovery-message-service';
import type { GenerateSuggestionResult } from '../src/services/ai-suggestion-service';
import type { GenerateExplanationResult } from '../src/services/merchant-explanation-service';
import { testEnv } from './_env';

let app: FastifyInstance;
afterEach(() => app?.close());

describe('POST /api/recovery-actions/:recoveryActionId/message', () => {
  it('creates an AI-generated message', async () => {
    const result: GenerateMessageResult = {
      status: 'CREATED',
      duplicate: false,
      message: {
        id: 'msg_1',
        paymentId: 'pay_1',
        recoveryActionId: 'act_1',
        channel: 'SMS',
        language: 'EN',
        content: 'Your bank is temporarily unavailable. We will try again shortly.',
        reason: 'Communicates a temporary issuer failure without promising recovery.',
        source: 'AI',
        createdAt: '2026-09-04T10:00:00.000Z',
      },
    };
    app = await buildApp(testEnv, { aiDeps: { generateMessage: async () => result } });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/act_1/message' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'CREATED', duplicate: false, message: result.message });
  });

  it('never sends a message when the policy did not request one', async () => {
    app = await buildApp(testEnv, {
      aiDeps: { generateMessage: async () => ({ status: 'MESSAGE_NOT_REQUESTED' }) },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/act_1/message' });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('MESSAGE_NOT_REQUESTED');
  });

  it('is idempotent: a second call returns DUPLICATE, never a second message', async () => {
    const message = {
      id: 'msg_1',
      paymentId: 'pay_1',
      recoveryActionId: 'act_1',
      channel: 'SMS',
      language: 'EN',
      content: 'x',
      reason: 'y',
      source: 'AI' as const,
      createdAt: '2026-09-04T10:00:00.000Z',
    };
    app = await buildApp(testEnv, {
      aiDeps: { generateMessage: async () => ({ status: 'DUPLICATE', duplicate: true, message }) },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/act_1/message' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('DUPLICATE');
  });

  it('404s for an unknown recovery action', async () => {
    app = await buildApp(testEnv, {
      aiDeps: { generateMessage: async () => ({ status: 'ACTION_NOT_FOUND' }) },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/missing/message' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/payments/failures/:failureId/ai-suggestion', () => {
  it('creates a suggestion that is not the classification source RULE/HUMAN', async () => {
    const result: GenerateSuggestionResult = {
      status: 'CREATED',
      duplicate: false,
      suggestion: {
        classificationId: 'cls_ai_1',
        failureId: 'fail_1',
        suggestedRootCause: 'ISSUER_TEMPORARY_FAILURE',
        confidence: 0.71,
        explanation: 'Description mentions an upstream timeout pattern.',
        source: 'AI',
        createdAt: '2026-09-04T10:00:00.000Z',
      },
    };
    app = await buildApp(testEnv, { aiDeps: { generateSuggestion: async () => result } });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/payments/failures/fail_1/ai-suggestion' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.suggestion.suggestedRootCause).toBe('ISSUER_TEMPORARY_FAILURE');
    // Never carries an action/schedule field — a suggestion is not a decision.
    expect(body.suggestion).not.toHaveProperty('action');
    expect(body.suggestion).not.toHaveProperty('scheduledFor');
  });

  it('refuses when the current classification does not need a suggestion', async () => {
    app = await buildApp(testEnv, {
      aiDeps: {
        generateSuggestion: async () =>
          ({ status: 'NOT_ELIGIBLE', reason: 'Current classification is high-confidence.' }) as GenerateSuggestionResult,
      },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/payments/failures/fail_1/ai-suggestion' });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('NOT_ELIGIBLE');
  });

  it('404s for an unknown failure', async () => {
    app = await buildApp(testEnv, {
      aiDeps: { generateSuggestion: async () => ({ status: 'FAILURE_NOT_FOUND' }) },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/payments/failures/missing/ai-suggestion' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/recovery-actions/:recoveryActionId/explanation', () => {
  it('returns an explanation with its source clearly labeled', async () => {
    const result: GenerateExplanationResult = {
      status: 'OK',
      source: 'FALLBACK',
      explanation: {
        summary: 'WAIT recommended.',
        explanation: 'Issuer failed temporarily. Retry after an 18-minute cooldown.',
      },
    };
    app = await buildApp(testEnv, { aiDeps: { generateExplanation: async () => result } });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/act_1/explanation' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'OK', source: 'FALLBACK', explanation: result.explanation });
  });

  it('404s for an unknown recovery action', async () => {
    app = await buildApp(testEnv, {
      aiDeps: { generateExplanation: async () => ({ status: 'ACTION_NOT_FOUND' }) },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/recovery-actions/missing/explanation' });
    expect(res.statusCode).toBe(404);
  });
});
