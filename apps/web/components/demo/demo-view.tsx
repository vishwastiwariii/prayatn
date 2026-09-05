'use client';

import Link from 'next/link';
import { ChevronRight, Play, RotateCcw, Zap } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { AISourceBadge } from '@/components/ui/ai-source-badge';
import { AIBoundaryCard } from '@/components/demo/ai-boundary-card';
import { CircuitTheatre } from '@/components/demo/circuit-theatre';
import { DemoActivityFeed } from '@/components/demo/demo-activity-feed';
import { DemoHealthPanel } from '@/components/demo/demo-health-panel';
import { DemoPaymentGrid } from '@/components/demo/demo-payment-grid';
import { DemoResults } from '@/components/demo/demo-results';
import { StageStepper } from '@/components/demo/stage-stepper';
import { stageAtLeast } from '@/components/demo/stage-order';
import { ROOT_CAUSE_LABEL } from '@/lib/api/types';
import { formatMinorAsRupees } from '@/lib/format';
import { useDemoControls, useDemoState } from '@/lib/queries';

/**
 * Phase 13 §1 — the storytelling interface. The operations dashboard at `/`
 * is the product; this page is the argument. Everything it shows is read from
 * the same live API the dashboard uses.
 */
export function DemoView() {
  const { data, isPending, isError, refetch } = useDemoState();
  const { reset, start, advance, drain } = useDemoControls();

  const busy = reset.isPending || start.isPending || advance.isPending || drain.isPending;

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-border bg-surface-1">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">Recovery Desk</h1>
            <p className="text-sm text-text-secondary">Intelligent payment failure recovery</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] text-text-secondary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-good" />
              LIVE SIMULATION
              {data && (
                <>
                  <span className="text-text-muted">·</span>
                  <span>seed {data.constants.seed}</span>
                  <span className="text-text-muted">·</span>
                  <span>{data.constants.datasetVersion}</span>
                </>
              )}
            </span>
            <Link
              href="/"
              className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2"
            >
              Operations dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        {isError ? (
          <ErrorState message="Unable to reach the demo API." onRetry={() => refetch()} />
        ) : isPending || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* --- control bar ------------------------------------------- */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {data.meta.title}
                  </p>
                  <p className="text-base font-medium text-text-primary">{data.meta.headline}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => reset.mutate()}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
                  >
                    <RotateCcw size={13} /> Reset
                  </button>
                  {!data.demoId ? (
                    <button
                      onClick={() => start.mutate()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
                    >
                      <Play size={14} /> Start demo
                    </button>
                  ) : data.stage === 'COMPLETE' ? (
                    <span className="rounded-md bg-status-good-bg px-3 py-1.5 text-xs font-medium text-status-good">
                      Demo complete
                    </span>
                  ) : (
                    <>
                      {data.stage === 'RECOVERY_RESUMED' && (
                        <button
                          onClick={() => drain.mutate()}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
                        >
                          <Zap size={13} /> Drain next batch
                        </button>
                      )}
                      <button
                        onClick={() => advance.mutate()}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
                      >
                        {busy ? 'Working…' : data.meta.nextLabel}
                        <ChevronRight size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="border-t border-border px-4 py-2.5">
                <StageStepper stages={data.stages} current={data.stage} />
              </div>
            </Card>

            {/* --- headline counters -------------------------------------- */}
            {data.demoId && (
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-6">
                <Counter label="Failed" value={String(data.counters.failures)} />
                <Counter label="At risk" value={formatMinorAsRupees(data.counters.amountAtRiskMinor)} />
                <Counter label="Diagnosed" value={String(data.counters.classified)} />
                <Counter label="Queued" value={String(data.counters.queued)} />
                <Counter label="Blocked by circuit" value={String(data.counters.blockedByCircuit)} />
                <Counter
                  label="Recovered"
                  value={`${data.counters.recovered} · ${formatMinorAsRupees(data.counters.amountRecoveredMinor)}`}
                />
              </div>
            )}

            {/* --- stage body --------------------------------------------- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {!data.demoId && <DemoHealthPanel />}

                {data.demoId && <DemoPaymentGrid payments={data.payments} stage={data.stage} />}

                {stageAtLeast(data.stage, 'GATEWAY_STORM') && (
                  <CircuitTheatre counters={data.counters} />
                )}

                {stageAtLeast(data.stage, 'AI_MESSAGE') && <AIMessagePanel payments={data.payments} />}

                {stageAtLeast(data.stage, 'HUMAN_REVIEW') && (
                  <HumanReviewPanel payments={data.payments} />
                )}

                {stageAtLeast(data.stage, 'RESULTS') && <DemoResults />}
              </div>

              <div className="space-y-4">
                <DemoActivityFeed events={data.events} />
                {stageAtLeast(data.stage, 'AI_MESSAGE') && <AIBoundaryCard />}
                {data.demoId && <DemoHealthPanel />}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function AIMessagePanel({ payments }: { payments: Array<{ paymentId: string; message: { content: string; language: string; source: 'AI' | 'FALLBACK' } | null; classification: { cause: string | null } | null }> }) {
  const withMessage = payments.filter((p) => p.message);

  return (
    <Card>
      <CardHeader
        title="Customer message"
        subtitle="The policy engine already decided. AI only wrote the words."
      />
      <div className="p-4">
        {withMessage.length === 0 ? (
          <p className="text-sm text-text-secondary">No message generated yet.</p>
        ) : (
          <ul className="space-y-3">
            {withMessage.map((p) => (
              <li key={p.paymentId} className="rounded-md border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-primary">
                    {p.paymentId.replace('demo_', '')} · {p.message?.language}
                  </span>
                  {p.message && <AISourceBadge source={p.message.source} />}
                </div>
                <p className="mt-1.5 text-sm text-text-primary">“{p.message?.content}”</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function HumanReviewPanel({
  payments,
}: {
  payments: Array<{
    paymentId: string;
    amountMinor: number;
    failure: { code: string } | null;
    classification: { cause: string | null; confidence: number | null; source: string | null } | null;
    aiSuggestion: { cause: string; confidence: number; explanation: string | null } | null;
  }>;
}) {
  const unknowns = payments.filter((p) => p.aiSuggestion || p.classification?.cause === 'UNKNOWN');

  return (
    <Card>
      <CardHeader
        title="Unknown failure"
        subtitle="AI suggests. A human decides. The suggestion is never authoritative."
      />
      <div className="space-y-3 p-4">
        {unknowns.length === 0 ? (
          <p className="text-sm text-text-secondary">No unknown failures in this run.</p>
        ) : (
          unknowns.map((p) => (
            <div key={p.paymentId} className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-primary">
                  {p.paymentId.replace('demo_', '')} · {formatMinorAsRupees(p.amountMinor)} ·{' '}
                  {p.failure?.code}
                </span>
                {p.aiSuggestion && <AISourceBadge source="AI" />}
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex gap-2">
                  <dt className="text-text-muted">Rule classifier:</dt>
                  <dd className="text-text-secondary">
                    {p.classification?.cause ? ROOT_CAUSE_LABEL[p.classification.cause as keyof typeof ROOT_CAUSE_LABEL] : '—'}{' '}
                    {p.classification?.confidence != null &&
                      `· ${Math.round(p.classification.confidence * 100)}%`}
                    {p.classification?.source === 'HUMAN' && ' · confirmed by a human'}
                  </dd>
                </div>
                {p.aiSuggestion && (
                  <>
                    <div className="flex gap-2">
                      <dt className="text-text-muted">AI suggestion:</dt>
                      <dd className="text-text-secondary">
                        {ROOT_CAUSE_LABEL[p.aiSuggestion.cause as keyof typeof ROOT_CAUSE_LABEL]} ·{' '}
                        {Math.round(p.aiSuggestion.confidence * 100)}% suggestion confidence
                      </dd>
                    </div>
                    {p.aiSuggestion.explanation && (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-text-muted">Why:</dt>
                        <dd className="text-text-secondary">{p.aiSuggestion.explanation}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-status-serious">
                  {p.classification?.source === 'HUMAN'
                    ? 'Human approved — classification source is HUMAN.'
                    : 'Human approval required before any policy decision.'}
                </p>
                <Link
                  href={`/payments/${p.paymentId}`}
                  className="shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-medium text-text-primary hover:bg-surface-2"
                >
                  Review
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
