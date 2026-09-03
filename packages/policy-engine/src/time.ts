/**
 * Pure UTC time helpers. Everything is computed from the injected `now` so the
 * engine is fully deterministic and testable. "Day" and "hour" mean UTC day and
 * UTC hour throughout.
 */

const MINUTE_MS = 60_000;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

/** Whole minutes from `a` to `b` (rounded up; never negative). */
export function minutesUntil(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / MINUTE_MS));
}

/**
 * Quiet hours are a wrapping window, e.g. start=22 end=8 covers 22:00-07:59.
 * A non-wrapping window (start < end) is also supported.
 */
export function isWithinQuietHours(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getUTCHours();
  if (startHour === endHour) return false;
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

/** The next instant at `endHour:00:00` UTC that is strictly after `now`. */
export function nextHourBoundary(now: Date, endHour: number): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), endHour, 0, 0, 0),
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

function clampSalaryDay(day: number): number {
  return Math.min(28, Math.max(1, Math.trunc(day)));
}

function salaryInstant(year: number, monthIndex: number, day: number): Date {
  // 09:00 UTC on the salary day — the start of the "money has landed" window.
  return new Date(Date.UTC(year, monthIndex, day, 9, 0, 0, 0));
}

export interface SalaryWindowResult {
  delayMinutes: number;
  /** `before_window` | `in_window` | `next_month` | `salary_day_unknown` */
  situation: string;
  windowStart: Date | null;
}

/**
 * Minutes to wait before retrying a funds-low failure.
 *
 *   now < this month's salary day        -> wait until it (money expected then)
 *   now inside [salaryDay, salaryDay+2d]  -> short wait (money likely there now)
 *   now past the window                   -> wait for next month's salary day
 *   salaryDay unknown                     -> fixed fallback
 */
export function minutesUntilSalaryWindow(
  now: Date,
  salaryDay: number | null | undefined,
  fallbackMinutes: number,
): SalaryWindowResult {
  if (salaryDay == null || !Number.isFinite(salaryDay)) {
    return { delayMinutes: fallbackMinutes, situation: 'salary_day_unknown', windowStart: null };
  }

  const day = clampSalaryDay(salaryDay);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const thisMonth = salaryInstant(year, month, day);
  const windowEnd = addMinutes(thisMonth, 2 * 24 * 60);

  if (now.getTime() < thisMonth.getTime()) {
    return {
      delayMinutes: minutesUntil(now, thisMonth),
      situation: 'before_window',
      windowStart: thisMonth,
    };
  }

  if (now.getTime() < windowEnd.getTime()) {
    // Salary has (probably) landed; retry within the hour.
    return { delayMinutes: 60, situation: 'in_window', windowStart: thisMonth };
  }

  const nextMonth = salaryInstant(year, month + 1, day);
  return {
    delayMinutes: minutesUntil(now, nextMonth),
    situation: 'next_month',
    windowStart: nextMonth,
  };
}
