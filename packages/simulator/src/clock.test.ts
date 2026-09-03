import { describe, expect, it } from 'vitest';
import { SIM_EPOCH, createClock, epochPlus } from './clock';

describe('createClock', () => {
  it('starts at the given instant', () => {
    const c = createClock(SIM_EPOCH.getTime());
    expect(c.now().toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(c.minutesSinceStart()).toBe(0);
  });

  it('advances by minutes and tracks elapsed', () => {
    const c = createClock(SIM_EPOCH.getTime());
    c.advance(18);
    expect(c.now().toISOString()).toBe('2026-09-01T00:18:00.000Z');
    expect(c.minutesSinceStart()).toBe(18);
    c.advance(42);
    expect(c.minutesSinceStart()).toBe(60);
  });

  it('never goes backwards', () => {
    const c = createClock(SIM_EPOCH.getTime());
    c.advance(-100);
    expect(c.minutesSinceStart()).toBe(0);
  });

  it('epochPlus is relative to the epoch', () => {
    expect(epochPlus(0)).toBe(SIM_EPOCH.getTime());
    expect(epochPlus(60)).toBe(SIM_EPOCH.getTime() + 3_600_000);
  });
});
