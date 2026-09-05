import { FileText, Sparkles } from 'lucide-react';
import type { MessageSource } from '@/lib/api/payments';

/**
 * Phase 12 §25 — every AI-generated artifact clearly shows ✨ AI Generated,
 * and a fallback is just as clearly a Fallback Template. Never ambiguous.
 */
export function AISourceBadge({ source }: { source: MessageSource }) {
  if (source === 'AI') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ color: 'var(--accent)', background: 'color-mix(in oklab, var(--accent) 14%, transparent)' }}
      >
        <Sparkles size={12} />
        AI Generated
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: 'var(--status-neutral)', background: 'var(--status-neutral-bg)' }}
    >
      <FileText size={12} />
      Fallback Template
    </span>
  );
}
