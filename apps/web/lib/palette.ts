/** Categorical hue slot -> CSS custom property (fixed order, never cycled). */
export function catColor(slot: number): string {
  const n = ((slot - 1) % 8) + 1;
  return `var(--cat-${n})`;
}

export type StatusTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

export function statusVar(tone: StatusTone): { fg: string; bg: string } {
  return { fg: `var(--status-${tone})`, bg: `var(--status-${tone}-bg)` };
}
