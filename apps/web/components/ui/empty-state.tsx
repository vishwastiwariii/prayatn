import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="text-text-muted">{icon ?? <Inbox size={22} />}</div>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {description && <p className="max-w-xs text-xs text-text-muted">{description}</p>}
    </div>
  );
}
