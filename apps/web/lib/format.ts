import { formatDistanceToNowStrict } from 'date-fns';

/** Compact ₹ formatting: ₹4.82L / ₹1.2Cr for large amounts, else ₹1,234. */
export function formatMinorAsRupees(minor: number): string {
  const rupees = minor / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(rupees / 1e5).toFixed(2)}L`;
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
}

export function formatMinorAsRupeesPrecise(minor: number): string {
  return `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatRelativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
