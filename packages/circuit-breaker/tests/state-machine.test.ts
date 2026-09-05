import { describe, expect, it } from 'vitest';
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../src/config';
import {
  effectiveState,
  evaluatePermission,
  halfOpenTransition,
  remainingCooldownSeconds,
  shouldOpen,
} from '../src/state-machine';
import type { CircuitSnapshot } from '../src/types';

const CFG = DEFAULT_CIRCUIT_BREAKER_CONFIG; // threshold 5, window 60s, cooldown 30s

function snap(over: Partial<CircuitSnapshot> = {}): CircuitSnapshot {
  return {
    state: 'CLOSED',
    failureCount: 0,
    openedAt: null,
    reason: null,
    probeInProgress: false,
    ...over,
  };
}

describe('state machine — pure & deterministic', () => {
  it('Test 1 — starts closed', () => {
    expect(snap().state).toBe('CLOSED');
    expect(effectiveState(snap(), CFG, 0)).toBe('CLOSED');
    expect(evaluatePermission(snap(), CFG, 0)).toEqual({ allowed: true, isProbe: false });
  });

  it('Test 2 — below threshold remains closed (4 failures, threshold 5)', () => {
    expect(shouldOpen(4, CFG)).toBe(false);
    expect(effectiveState(snap({ failureCount: 4 }), CFG, 0)).toBe('CLOSED');
  });

  it('Test 3 — threshold opens circuit (5 failures, threshold 5)', () => {
    expect(shouldOpen(5, CFG)).toBe(true);
    expect(shouldOpen(7, CFG)).toBe(true);
  });

  it('Test 4 — cooldown enters half-open (OPEN + cooldown elapsed -> HALF_OPEN)', () => {
    const openedAt = 1_000_000;
    const s = snap({ state: 'OPEN', openedAt });
    expect(effectiveState(s, CFG, openedAt + 29_000)).toBe('OPEN');
    expect(effectiveState(s, CFG, openedAt + 30_000)).toBe('HALF_OPEN');
    expect(remainingCooldownSeconds(s, CFG, openedAt + 10_000)).toBe(20);
    expect(remainingCooldownSeconds(s, CFG, openedAt + 40_000)).toBe(0);
  });

  it('Test 5 — successful probe closes circuit', () => {
    expect(halfOpenTransition('PROBE_SUCCESS')).toBe('CLOSED');
  });

  it('Test 6 — failed probe reopens circuit', () => {
    expect(halfOpenTransition('GATEWAY_FAILURE')).toBe('OPEN');
  });

  it('OPEN request is blocked with a retry hint', () => {
    const openedAt = 5_000;
    const s = snap({ state: 'OPEN', openedAt });
    const perm = evaluatePermission(s, CFG, openedAt + 10_000);
    expect(perm).toMatchObject({ allowed: false, reason: 'CIRCUIT_OPEN' });
    if (!perm.allowed) expect(perm.retryAfterSeconds).toBe(20);
  });

  it('HALF_OPEN allows exactly one probe (second is blocked while one is in progress)', () => {
    const half = snap({ state: 'HALF_OPEN' });
    expect(evaluatePermission(half, CFG, 0)).toEqual({ allowed: true, isProbe: true });
    expect(evaluatePermission({ ...half, probeInProgress: true }, CFG, 0)).toMatchObject({
      allowed: false,
      reason: 'PROBE_ALREADY_IN_PROGRESS',
    });
  });
});
