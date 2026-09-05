import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Signed delta text, e.g. "+21.7% vs Naive". Color follows `deltaGood`. */
  delta?: string;
  deltaGood?: boolean;
  hint?: string;
}

export function StatTile({ label, value, delta, deltaGood, hint }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-2xl font-semibold text-text-primary">{value}</span>
      {delta && (
        <span
          className={cn(
            'text-xs font-medium',
            deltaGood === false ? 'text-status-critical' : 'text-status-good',
          )}
        >
          {delta}
        </span>
      )}
      {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
    </div>
  );
}
