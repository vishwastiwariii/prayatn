import { AlertTriangle } from 'lucide-react';

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <AlertTriangle size={22} className="text-status-critical" />
      <p className="text-sm font-medium text-text-secondary">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-primary hover:bg-surface-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}
