import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanReviewPreview } from '@/components/payments/human-review-preview';
import type { HumanReviewListResult } from '@/lib/api/human-review';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

afterEach(() => vi.unstubAllGlobals());

describe('HumanReviewPreview', () => {
  it('shows the empty state when nothing needs review', async () => {
    const empty: HumanReviewListResult = { items: [], total: 0 };
    mockFetchByPath({ '/api/human-review': () => ({ status: 200, body: empty }) });

    renderWithQueryClient(<HumanReviewPreview />);
    await waitFor(() => expect(screen.getByText('No human reviews required')).toBeInTheDocument());
    expect(screen.getByText('Recovery Desk is operating normally.')).toBeInTheDocument();
  });

  it('shows the AI suggestion clearly labeled, with a link to review — no execute action', async () => {
    const populated: HumanReviewListResult = {
      total: 1,
      items: [
        {
          paymentId: 'pay_2018',
          amountMinor: 840_000,
          currency: 'INR',
          failureId: 'fail_2018',
          errorCode: 'UNKNOWN_ERROR',
          errorReason: 'processor_rejected',
          errorDescription: 'Transaction declined by upstream processor.',
          currentCause: 'UNKNOWN',
          currentConfidence: 0.3,
          aiSuggestion: {
            classificationId: 'cls_ai_1',
            cause: 'ISSUER_TEMPORARY_FAILURE',
            confidence: 0.71,
            explanation: 'Description mentions an upstream timeout pattern.',
            createdAt: '2026-09-04T10:05:00.000Z',
          },
          enteredReviewAt: '2026-09-04T10:00:00.000Z',
        },
      ],
    };
    mockFetchByPath({ '/api/human-review': () => ({ status: 200, body: populated }) });

    renderWithQueryClient(<HumanReviewPreview />);
    await waitFor(() => expect(screen.getByText('pay_2018')).toBeInTheDocument());
    expect(screen.getByText('AI Generated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/payments/pay_2018');
    // No automatic execution affordance anywhere on this preview card.
    expect(screen.queryByRole('button', { name: /retry|execute|accept|reject/i })).not.toBeInTheDocument();
  });
});
