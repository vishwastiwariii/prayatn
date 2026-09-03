/**
 * Simulation clock. There is no wall-clock read anywhere in the experiment;
 * every "now" comes from here so runs are reproducible.
 *
 * The experiment epoch is fixed. Each payment gets its own clock, started at
 * the payment's origination time and advanced by the delays a strategy chooses
 * (0 for a naive immediate retry, `delayMinutes` for a Recovery Desk wait).
 */
export const SIM_EPOCH = new Date('2026-09-01T00:00:00.000Z');
export const MINUTE_MS = 60_000;

export interface SimClock {
  now(): Date;
  nowMs(): number;
  minutesSinceStart(): number;
  advance(minutes: number): void;
}

export function createClock(startAtMs: number): SimClock {
  const start = startAtMs;
  let cursor = startAtMs;
  return {
    now: () => new Date(cursor),
    nowMs: () => cursor,
    minutesSinceStart: () => Math.round((cursor - start) / MINUTE_MS),
    advance: (minutes) => {
      cursor += Math.max(0, minutes) * MINUTE_MS;
    },
  };
}

/** Epoch-ms for `SIM_EPOCH + offsetMinutes`. */
export function epochPlus(offsetMinutes: number): number {
  return SIM_EPOCH.getTime() + offsetMinutes * MINUTE_MS;
}
