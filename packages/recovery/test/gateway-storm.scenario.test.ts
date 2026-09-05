import { describe, expect, it } from 'vitest';
import { runGatewayStormScenario } from '../src/storm-scenario';

/**
 * Phase 10 §20 — the failure-scenario test.
 *
 * 20 seeded payments, gateway healthy until minute 60, then a 5xx storm. Proves:
 *   - the first 5 gateway failures happen while the circuit is CLOSED
 *   - the 5th qualifying failure OPENS the circuit
 *   - every remaining job during the outage is blocked with NO gateway call
 *   - there is no uncontrolled retry storm
 *   - after cooldown the circuit goes HALF_OPEN, one probe runs, and on success
 *     it CLOSES and queued work drains
 */
describe('gateway storm — end to end', () => {
  it('stops, waits, probes, and resumes — without a retry storm', async () => {
    const r = await runGatewayStormScenario({ payments: 20, failureThreshold: 5 });

    // eslint-disable-next-line no-console
    console.table(r.trace);

    const opened = r.trace.findIndex((row) => row.circuitBefore === 'OPEN');
    // First 5 rows: circuit CLOSED, gateway was actually called (and 5xx'd).
    for (let i = 0; i < 5; i += 1) {
      expect(r.trace[i]?.circuitBefore).toBe('CLOSED');
      expect(r.trace[i]?.gatewayCall).toBe('yes');
      expect(r.trace[i]?.result).toBe('CIRCUIT_BLOCKED');
    }
    // The circuit is OPEN by row 6.
    expect(opened).toBe(5);

    // While OPEN, jobs are blocked and the gateway is NOT called.
    const openRows = r.trace.filter((row) => row.circuitBefore === 'OPEN');
    expect(openRows.length).toBeGreaterThan(0);
    for (const row of openRows) {
      expect(row.gatewayCall).toBe('no');
      expect(row.result).toBe('CIRCUIT_BLOCKED');
    }

    // No amplification: from the storm's start until the circuit recovers, the
    // gateway is hit at most `threshold` times + one probe (not 20).
    const firstRecovery = r.trace.findIndex((row) => row.result === 'EXECUTED_SUCCESS');
    const callsDuringOutage = r.trace
      .slice(0, firstRecovery + 1)
      .filter((row) => row.gatewayCall === 'yes').length;
    expect(callsDuringOutage).toBeLessThanOrEqual(6);
    // The probe row is the first recovery, and it ran HALF_OPEN.
    expect(r.trace[firstRecovery]?.circuitBefore).toBe('HALF_OPEN');

    // Circuit lifecycle audited exactly once each.
    const types = r.audits.map((a) => a.eventType);
    expect(types.filter((t) => t === 'CIRCUIT_OPENED')).toHaveLength(1);
    expect(types.filter((t) => t === 'CIRCUIT_HALF_OPEN')).toHaveLength(1);
    expect(types.filter((t) => t === 'CIRCUIT_PROBE_SUCCEEDED')).toHaveLength(1);
    expect(types.filter((t) => t === 'CIRCUIT_CLOSED')).toHaveLength(1);
    expect(types.filter((t) => t === 'RECOVERY_BLOCKED_BY_CIRCUIT').length).toBeGreaterThanOrEqual(
      6,
    );

    // Recovery resumes after the circuit closes.
    expect(r.finalCircuitState).toBe('CLOSED');
    expect(r.metrics.probeAttempts).toBe(1);
    expect(r.metrics.successfulProbes).toBe(1);
    expect(r.recoveredPayments).toBeGreaterThanOrEqual(1);
    const lastRow = r.trace.at(-1);
    expect(lastRow?.result).toBe('EXECUTED_SUCCESS');

    // The simulator parameters are visible (no hidden tuning).
    expect(r.simulatorConfig.gatewayStorm).toMatchObject({ startMinute: 60, durationMinutes: 10 });
  });

  it('is deterministic for a seed', async () => {
    const a = await runGatewayStormScenario({ seed: 42, payments: 15 });
    const b = await runGatewayStormScenario({ seed: 42, payments: 15 });
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect(a.gatewayCharges).toBe(b.gatewayCharges);
  });
});
