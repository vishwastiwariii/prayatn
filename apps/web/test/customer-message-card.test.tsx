import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerMessageCard } from '@/components/recovery/customer-message-card';
import type { PaymentDetail } from '@/lib/api/payments';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

afterEach(() => vi.unstubAllGlobals());

const action: PaymentDetail['recoveryActions'][number] = {
  id: 'act_1',
  cause: 'CUSTOMER_ABANDONMENT',
  action: 'MESSAGE',
  status: 'PENDING',
  attemptNumber: 2,
  scheduledFor: null,
  reason: 'Customer did not complete authentication.',
  delayMinutes: 0,
  maxAttempts: 2,
  requiresCustomerMessage: true,
  createdAt: '2026-09-04T10:00:00.000Z',
  executedAt: null,
  outcome: null,
};

describe('CustomerMessageCard — no message yet', () => {
  it('offers to generate one, and calling it renders the result with a clear AI/fallback badge', async () => {
    mockFetchByPath({
      '/api/recovery-actions/act_1/message': () => ({
        status: 201,
        body: {
          status: 'CREATED',
          duplicate: false,
          message: {
            id: 'msg_1',
            paymentId: 'pay_1',
            recoveryActionId: 'act_1',
            channel: 'SMS',
            language: 'HINGLISH',
            content: 'Aapka payment complete nahi hua.',
            reason: 'Deterministic fallback template.',
            source: 'FALLBACK',
            createdAt: '2026-09-04T10:05:00.000Z',
          },
        },
      }),
    });

    renderWithQueryClient(<CustomerMessageCard action={action} message={undefined} paymentId="pay_1" />);
    expect(screen.getByText('No message generated yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate message/i }));
    await waitFor(() => expect(screen.getByText('Aapka payment complete nahi hua.')).toBeInTheDocument());
  });
});

describe('CustomerMessageCard — message already exists', () => {
  it('renders the AI-generated message with its badge, no generate button', () => {
    mockFetchByPath({});
    const message: PaymentDetail['messages'][number] = {
      id: 'msg_1',
      recoveryActionId: 'act_1',
      channel: 'SMS',
      language: 'EN',
      content: 'Your bank is temporarily unavailable. We will try again shortly.',
      reason: 'Communicates a temporary issuer failure without promising recovery.',
      source: 'AI',
      createdAt: '2026-09-04T10:00:00.000Z',
    };
    renderWithQueryClient(<CustomerMessageCard action={action} message={message} paymentId="pay_1" />);
    expect(screen.getByText(message.content)).toBeInTheDocument();
    expect(screen.getByText('AI Generated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate message/i })).not.toBeInTheDocument();
  });
});
