import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentTable } from '@/components/payments/payment-table';
import type { PaymentListResult } from '@/lib/api/payments';
import { mockFetchByPath, renderWithQueryClient } from './test-utils';

const oneItem: PaymentListResult = {
  items: [
    {
      paymentId: 'pay_8392',
      amountMinor: 250_000,
      currency: 'INR',
      method: 'UPI',
      status: 'RECOVERING',
      recoveryStatus: 'SCHEDULED',
      attemptCount: 1,
      cause: 'ISSUER_TEMPORARY_FAILURE',
      confidence: 0.98,
      action: 'RETRY',
      actionStatus: 'SCHEDULED',
      maxAttempts: 3,
      scheduledFor: '2026-09-04T10:30:00.000Z',
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe('PaymentTable', () => {
  it('shows loading skeletons, then rows', async () => {
    mockFetchByPath({ '/api/payments': () => ({ status: 200, body: oneItem }) });
    renderWithQueryClient(<PaymentTable />);
    await waitFor(() => expect(screen.getByText('pay_8392')).toBeInTheDocument());
  });

  it('shows an empty state for no matches', async () => {
    mockFetchByPath({
      '/api/payments': () => ({ status: 200, body: { items: [], total: 0, limit: 20, offset: 0 } }),
    });
    renderWithQueryClient(<PaymentTable />);
    await waitFor(() =>
      expect(screen.getByText('No payments match these filters')).toBeInTheDocument(),
    );
  });

  it('shows an error state with retry', async () => {
    mockFetchByPath({ '/api/payments': () => ({ status: 500, body: { status: 'ERROR', error: 'db down' } }) });
    renderWithQueryClient(<PaymentTable />);
    await waitFor(() => expect(screen.getByText('Unable to load payments.')).toBeInTheDocument());
  });

  it('forwards the root-cause filter to the API request', async () => {
    const fetchSpy = mockFetchByPath({ '/api/payments': () => ({ status: 200, body: oneItem }) });
    renderWithQueryClient(<PaymentTable />);
    await waitFor(() => expect(screen.getByText('pay_8392')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: 'Root cause' }), {
      target: { value: 'ISSUER_TEMPORARY_FAILURE' },
    });

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls.at(-1)?.[0] as string;
      expect(new URL(lastCall).searchParams.get('cause')).toBe('ISSUER_TEMPORARY_FAILURE');
    });
  });
});
