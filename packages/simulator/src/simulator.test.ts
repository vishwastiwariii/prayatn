import { describe, expect, it } from 'vitest';
import { generateDataset } from './dataset';
import { createHiddenStateSimulator } from './simulator';

describe('createHiddenStateSimulator', () => {
  const dataset = generateDataset(20260828, 50);
  const sim = createHiddenStateSimulator(dataset);
  const anyId = dataset.payments[0]!.id;

  it('exposes the initial public failure descriptor', () => {
    const f = sim.initialFailure(anyId);
    expect(f).toHaveProperty('reason');
    expect(f).toHaveProperty('source');
  });

  it('adjudicates attempts deterministically', () => {
    const c = {
      attemptNumber: 2,
      atMs: dataset.payments[0]!.originatedAtMs + 60_000,
      originatedAtMs: dataset.payments[0]!.originatedAtMs,
      messagesSent: 0,
      railSwitched: false,
    };
    expect(sim.attempt(anyId, c)).toEqual(sim.attempt(anyId, c));
  });

  it('NEVER exposes the hidden truth', () => {
    // Only these four members exist on the simulator.
    expect(new Set(Object.keys(sim))).toEqual(
      new Set(['size', 'initialFailure', 'attempt', 'sendMessageLatencyMs']),
    );
    // No serialisable hidden fields leak.
    const serialised = JSON.stringify(sim, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
    for (const banned of [
      'resolvesAtMs',
      'customerCooperates',
      'needsNudge',
      'permanent',
      'truth',
      'scenario',
      'kind',
    ]) {
      expect(serialised).not.toContain(banned);
    }
    // No accessor returns a truth object.
    expect((sim as unknown as { truth?: unknown }).truth).toBeUndefined();
    expect((sim as unknown as { dataset?: unknown }).dataset).toBeUndefined();
  });

  it('throws for an unknown payment id', () => {
    expect(() => sim.initialFailure('nope')).toThrow();
  });
});
