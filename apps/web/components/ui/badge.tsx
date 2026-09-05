import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { type StatusTone, statusVar } from '@/lib/palette';

/** A status pill: icon + label, never color alone (dataviz skill, status palette). */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { fg, bg } = statusVar(tone);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={{ color: fg, background: bg }}
    >
      {icon}
      {children}
    </span>
  );
}
