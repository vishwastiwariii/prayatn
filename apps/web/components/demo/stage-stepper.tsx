'use client';

import { cn } from '@/lib/cn';
import type { DemoStage, DemoStageMeta } from '@/lib/api/demo';

/** The narrative spine of the demo — where we are, and what is still coming. */
export function StageStepper({
  stages,
  current,
}: {
  stages: DemoStageMeta[];
  current: DemoStage;
}) {
  const currentIndex = stages.findIndex((s) => s.stage === current);

  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {stages.map((stage, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={stage.stage} className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-300',
                active && 'border-accent bg-accent text-accent-ink',
                done && 'border-status-good/40 bg-status-good-bg text-status-good',
                !active && !done && 'border-border text-text-muted',
              )}
            >
              {stage.title}
            </span>
            {index < stages.length - 1 && <span className="text-text-muted">·</span>}
          </li>
        );
      })}
    </ol>
  );
}
