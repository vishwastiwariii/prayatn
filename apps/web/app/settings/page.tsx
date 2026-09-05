'use client';

import { Nav } from '@/components/nav';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { DEFAULT_EVALUATION_COUNT, DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';
import { useEvaluation, useGatewayCircuit } from '@/lib/queries';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const gateway = useGatewayCircuit();
  const evaluation = useEvaluation({ seed: DEFAULT_EVALUATION_SEED, count: DEFAULT_EVALUATION_COUNT });

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Simulator & reliability parameters</h1>
          <p className="text-sm text-text-secondary">
            Read-only. Everything below is the real configuration the running system enforces — never a value the
            frontend invents.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Evaluation dataset" subtitle="Frozen, seeded, reproducible" />
            <div className="p-4">
              {evaluation.isError ? (
                <ErrorState message="Unable to load evaluation config." onRetry={() => evaluation.refetch()} />
              ) : evaluation.isPending || !evaluation.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div>
                  <Field label="Dataset size" value={`${evaluation.data.datasetSize} payments`} />
                  <Field label="Seed" value={String(evaluation.data.primarySeed)} />
                  <Field label="Cost per attempt" value={`₹${(evaluation.data.costModel.perAttemptMinor / 100).toFixed(2)}`} />
                  <Field label="Cost per message" value={`₹${(evaluation.data.costModel.perMessageMinor / 100).toFixed(2)}`} />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Gateway circuit breaker" subtitle="Shared across workers via Redis" />
            <div className="p-4">
              {gateway.isError ? (
                <ErrorState message="Unable to load gateway config." onRetry={() => gateway.refetch()} />
              ) : gateway.isPending || !gateway.data?.config ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div>
                  <Field label="Failure threshold" value={`${gateway.data.config.circuit.failureThreshold} failures`} />
                  <Field label="Failure window" value={`${gateway.data.config.circuit.failureWindowSeconds}s`} />
                  <Field label="Open cooldown" value={`${gateway.data.config.circuit.openCooldownSeconds}s`} />
                  <Field label="Half-open probes" value={String(gateway.data.config.circuit.halfOpenMaxProbes)} />
                  <Field label="Drain batch size" value={String(gateway.data.config.drain.batchSize)} />
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Guardrail limits" subtitle="Enforced server-side in the policy engine" />
          <div className="p-4 text-sm text-text-secondary">
            Attempt ceilings, the customer-contact ceiling and quiet hours are enforced by{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">@recovery-desk/policy-engine</code> on every
            decision — see the Decision Inspector on any payment for the guardrails that applied to it. A dedicated
            read API for these constants (Phase 19/20 simulator-config surface) has not shipped yet, so this page
            does not restate the numbers here rather than risk them drifting from the real values.
          </div>
        </Card>
      </main>
    </div>
  );
}
