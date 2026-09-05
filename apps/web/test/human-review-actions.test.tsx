import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanReviewActions } from '@/components/payments/human-review-actions';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

afterEach(() => vi.unstubAllGlobals());

describe('HumanReviewActions — no AI suggestion yet', () => {
  it('offers to generate one, and never shows Accept without a suggestion to accept', async () => {
    mockFetchByPath({});
    renderWithQueryClient(<HumanReviewActions failureId="fail_1" paymentId="pay_1" aiSuggestion={null} />);

    expect(screen.getByRole('button', { name: /generate ai suggestion/i })).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
  });
});

describe('HumanReviewActions — AI suggestion present', () => {
  const suggestion = {
    cause: 'ISSUER_TEMPORARY_FAILURE' as const,
    confidence: 0.71,
    explanation: 'Description mentions an upstream timeout pattern.',
  };

  it('clearly labels the suggestion as AI-generated and not a fact', () => {
    mockFetchByPath({});
    renderWithQueryClient(
      <HumanReviewActions failureId="fail_1" paymentId="pay_1" aiSuggestion={suggestion} />,
    );
    expect(screen.getByText('AI Generated')).toBeInTheDocument();
    expect(screen.getByText('AI suggestion only. Human approval required.')).toBeInTheDocument();
    expect(screen.getByText(/upstream timeout pattern/)).toBeInTheDocument();
  });

  it('Accept resolves with the AI-suggested cause and never auto-executes a recovery action', async () => {
    const resolveSpy = mockFetchByPath({
      '/api/human-review/fail_1/resolve': () => ({
        status: 200,
        body: { status: 'RESOLVED', duplicate: false, classificationId: 'cls_h1', cause: 'ISSUER_TEMPORARY_FAILURE' },
      }),
    });
    renderWithQueryClient(
      <HumanReviewActions failureId="fail_1" paymentId="pay_1" aiSuggestion={suggestion} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(screen.getByText(/Recorded as/)).toBeInTheDocument());
    const call = resolveSpy.mock.calls.find(([url]) => String(url).includes('/human-review/'));
    expect(call).toBeDefined();
    const [, init] = (call ?? []) as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ decision: 'ACCEPT', rootCause: 'ISSUER_TEMPORARY_FAILURE', reason: expect.any(String) });

    // A "Run policy decision" affordance appears, but nothing has been executed yet —
    // it's a separate explicit step, not something this resolve call triggered.
    expect(screen.getByRole('button', { name: /run policy decision/i })).toBeInTheDocument();
  });

  it('Keep as unknown resolves without a rootCause', async () => {
    const spy = mockFetchByPath({
      '/api/human-review/fail_1/resolve': () => ({
        status: 200,
        body: { status: 'RESOLVED', duplicate: false, classificationId: 'cls_h2', cause: 'UNKNOWN' },
      }),
    });
    renderWithQueryClient(
      <HumanReviewActions failureId="fail_1" paymentId="pay_1" aiSuggestion={suggestion} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep as unknown' }));

    await waitFor(() => expect(screen.getByText(/Recorded as/)).toBeInTheDocument());
    const call = spy.mock.calls.find(([url]) => String(url).includes('/human-review/'));
    const [, init] = (call ?? []) as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.decision).toBe('KEEP_UNKNOWN');
    expect(body.rootCause).toBeUndefined();
  });
});
