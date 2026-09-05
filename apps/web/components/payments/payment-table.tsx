'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ActionBadge, RecoveryStatusBadge, RootCauseBadge } from '@/components/payments/status-badges';
import type { PaymentListFilters } from '@/lib/api/payments';
import type { PaymentMethod, RecoveryActionType, RecoveryStatus, RootCause } from '@/lib/api/types';
import { formatMinorAsRupees, formatRelativeTime } from '@/lib/format';
import { usePayments } from '@/lib/queries';

const STATUS_OPTIONS: RecoveryStatus[] = [
  'FAILED',
  'CLASSIFIED',
  'SCHEDULED',
  'RETRYING',
  'RECOVERED',
  'HARD_STOPPED',
  'EXHAUSTED',
  'HUMAN_REVIEW',
];
const CAUSE_OPTIONS: RootCause[] = [
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
];
const METHOD_OPTIONS: PaymentMethod[] = ['CARD', 'UPI', 'NETBANKING', 'WALLET', 'MANDATE'];
const ACTION_OPTIONS: RecoveryActionType[] = ['RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE', 'HARD_STOP', 'HUMAN_REVIEW'];

function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | '';
  onChange: (v: T | '') => void;
  options: readonly T[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T | '')}
      aria-label={placeholder}
      className="rounded-md border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

export interface PaymentTableProps {
  initialFilters?: PaymentListFilters;
  pageSize?: number;
}

export function PaymentTable({ initialFilters, pageSize = 20 }: PaymentTableProps) {
  const [filters, setFilters] = useState<PaymentListFilters>(initialFilters ?? {});
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  const effective: PaymentListFilters = { ...filters, q: q || undefined, limit: pageSize, offset };
  const { data, isPending, isError, refetch, isFetching } = usePayments(effective);

  function setFilter<K extends keyof PaymentListFilters>(key: K, value: PaymentListFilters[K]) {
    setOffset(0);
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  }

  return (
    <Card>
      <CardHeader
        title="Payment explorer"
        subtitle="Search and filter every payment Recovery Desk has seen"
        action={isFetching && !isPending ? <span className="text-[11px] text-text-muted">refreshing…</span> : null}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-1 px-2 py-1">
          <Search size={13} className="text-text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setOffset(0);
              setQ(e.target.value);
            }}
            placeholder="Search payment ID"
            className="w-40 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <Select value={filters.status ?? ''} onChange={(v) => setFilter('status', v || undefined)} options={STATUS_OPTIONS} placeholder="Status" />
        <Select value={filters.cause ?? ''} onChange={(v) => setFilter('cause', v || undefined)} options={CAUSE_OPTIONS} placeholder="Root cause" />
        <Select value={filters.method ?? ''} onChange={(v) => setFilter('method', v || undefined)} options={METHOD_OPTIONS} placeholder="Method" />
        <Select value={filters.action ?? ''} onChange={(v) => setFilter('action', v || undefined)} options={ACTION_OPTIONS} placeholder="Action" />
        {(filters.status || filters.cause || filters.method || filters.action || q) && (
          <button
            onClick={() => {
              setFilters({});
              setQ('');
              setOffset(0);
            }}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {isError ? (
        <div className="p-4">
          <ErrorState message="Unable to load payments." onRetry={() => refetch()} />
        </div>
      ) : isPending || !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState title="No payments match these filters" description="Try clearing a filter or searching a different payment ID." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2 font-medium">Payment</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Method</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Root cause</th>
                  <th className="px-2 py-2 font-medium">Confidence</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium">Attempts</th>
                  <th className="px-4 py-2 font-medium">Last event</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.items.map((p) => (
                  <tr key={p.paymentId} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/payments/${p.paymentId}`} className="font-medium text-accent hover:underline">
                        {p.paymentId}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-text-primary">{formatMinorAsRupees(p.amountMinor)}</td>
                    <td className="px-2 py-2 text-text-secondary">{p.method}</td>
                    <td className="px-2 py-2">
                      <RecoveryStatusBadge status={p.recoveryStatus} />
                    </td>
                    <td className="px-2 py-2">
                      <RootCauseBadge cause={p.cause} />
                    </td>
                    <td className="px-2 py-2 text-text-secondary">
                      {p.confidence == null ? '—' : `${Math.round(p.confidence * 100)}%`}
                    </td>
                    <td className="px-2 py-2">
                      <ActionBadge action={p.action} />
                    </td>
                    <td className="px-2 py-2 text-text-secondary">
                      {p.attemptCount}
                      {p.maxAttempts ? ` / ${p.maxAttempts}` : ''}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{formatRelativeTime(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-text-muted">
            <span>
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
                className="rounded border border-border-strong px-2 py-1 font-medium text-text-secondary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={offset + data.items.length >= data.total}
                onClick={() => setOffset(offset + pageSize)}
                className="rounded border border-border-strong px-2 py-1 font-medium text-text-secondary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
