'use client';

import { AlertTriangle, Check, X } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDemoHealth } from '@/lib/queries';

const CHECKS: Array<{ key: keyof CheckShape; label: string; fatal: boolean }> = [
  { key: 'database', label: 'Database', fatal: true },
  { key: 'redis', label: 'Redis', fatal: true },
  { key: 'worker', label: 'Recovery worker', fatal: false },
  { key: 'simulator', label: 'Simulator', fatal: true },
  { key: 'circuitBreaker', label: 'Circuit breaker', fatal: true },
  { key: 'evaluation', label: 'Evaluation', fatal: false },
  { key: 'ai', label: 'AI provider', fatal: false },
];

type CheckShape = {
  database: boolean;
  redis: boolean;
  worker: boolean;
  simulator: boolean;
  circuitBreaker: boolean;
  evaluation: boolean;
  ai: boolean;
};

/** Phase 13 §34 — run this before you hit record. */
export function DemoHealthPanel() {
  const { data, isPending } = useDemoHealth();

  return (
    <Card>
      <CardHeader title="Demo system check" subtitle="Run before presenting" />
      <div className="p-4">
        {isPending || !data ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            {data.configError && (
              <div className="mb-3 rounded-md border border-status-critical bg-status-critical-bg px-3 py-2 text-xs text-status-critical">
                <p className="font-semibold">Demo configuration error</p>
                <p>
                  Expected {data.configError.expectedDatasetVersion} / seed{' '}
                  {data.configError.expectedSeed}, got {data.configError.actualDatasetVersion} / seed{' '}
                  {data.configError.actualSeed}. Do not present against different data.
                </p>
              </div>
            )}
            <ul className="space-y-1.5">
              {CHECKS.map((check) => {
                const ok = data[check.key];
                const detail = data.details[check.key];
                return (
                  <li key={check.key} className="flex items-start justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1.5">
                      {ok ? (
                        <Check size={13} className="text-status-good" />
                      ) : check.fatal ? (
                        <X size={13} className="text-status-critical" />
                      ) : (
                        <AlertTriangle size={13} className="text-status-warning" />
                      )}
                      <span className="text-text-primary">{check.label}</span>
                    </span>
                    {detail && <span className="text-right text-text-muted">{detail}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
