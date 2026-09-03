import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  isWithinQuietHours,
  minutesUntil,
  minutesUntilSalaryWindow,
  nextHourBoundary,
} from './time';

describe('addMinutes / minutesUntil', () => {
  it('adds minutes', () => {
    expect(addMinutes(new Date('2026-09-10T12:00:00Z'), 18).toISOString()).toBe(
      '2026-09-10T12:18:00.000Z',
    );
  });
  it('minutesUntil rounds up and clamps at zero', () => {
    expect(minutesUntil(new Date('2026-09-10T12:00:00Z'), new Date('2026-09-10T12:17:30Z'))).toBe(
      18,
    );
    expect(minutesUntil(new Date('2026-09-10T12:00:00Z'), new Date('2026-09-10T11:00:00Z'))).toBe(
      0,
    );
  });
});

describe('isWithinQuietHours (wrapping 22:00 -> 08:00)', () => {
  it.each([
    ['2026-09-10T22:00:00Z', true],
    ['2026-09-10T23:30:00Z', true],
    ['2026-09-11T03:00:00Z', true],
    ['2026-09-11T07:59:00Z', true],
    ['2026-09-11T08:00:00Z', false],
    ['2026-09-10T12:00:00Z', false],
    ['2026-09-10T21:59:00Z', false],
  ])('%s -> %s', (iso, expected) => {
    expect(isWithinQuietHours(new Date(iso), 22, 8)).toBe(expected);
  });
});

describe('nextHourBoundary', () => {
  it('returns the upcoming HH:00 UTC strictly after now', () => {
    expect(nextHourBoundary(new Date('2026-09-10T23:30:00Z'), 8).toISOString()).toBe(
      '2026-09-11T08:00:00.000Z',
    );
    expect(nextHourBoundary(new Date('2026-09-10T06:00:00Z'), 8).toISOString()).toBe(
      '2026-09-10T08:00:00.000Z',
    );
  });
});

describe('minutesUntilSalaryWindow', () => {
  const fallback = 1440;

  it('unknown salary day -> fallback', () => {
    const r = minutesUntilSalaryWindow(new Date('2026-09-10T12:00:00Z'), null, fallback);
    expect(r).toMatchObject({ delayMinutes: fallback, situation: 'salary_day_unknown' });
  });

  it('before this month’s salary day -> wait until it', () => {
    const r = minutesUntilSalaryWindow(new Date('2026-09-05T12:00:00Z'), 10, fallback);
    expect(r.situation).toBe('before_window');
    // 2026-09-05 12:00 -> 2026-09-10 09:00
    expect(r.delayMinutes).toBe(
      minutesUntil(new Date('2026-09-05T12:00:00Z'), new Date('2026-09-10T09:00:00Z')),
    );
  });

  it('inside the [salaryDay, +2d] window -> short wait', () => {
    const r = minutesUntilSalaryWindow(new Date('2026-09-10T18:00:00Z'), 10, fallback);
    expect(r).toMatchObject({ delayMinutes: 60, situation: 'in_window' });
  });

  it('past the window -> wait for next month', () => {
    const r = minutesUntilSalaryWindow(new Date('2026-09-20T12:00:00Z'), 10, fallback);
    expect(r.situation).toBe('next_month');
    expect(r.windowStart?.toISOString()).toBe('2026-10-10T09:00:00.000Z');
  });

  it('clamps a silly salary day into [1, 28]', () => {
    const r = minutesUntilSalaryWindow(new Date('2026-09-01T00:00:00Z'), 31, fallback);
    expect(r.windowStart?.getUTCDate()).toBe(28);
  });
});
