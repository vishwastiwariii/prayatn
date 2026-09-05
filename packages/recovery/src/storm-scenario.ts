/**
 * End-to-end gateway-storm scenario (Phase 10 §20), DB-free and deterministic.
 *
 * Seeded payments -> gateway healthy -> minute N: 5xx storm -> circuit CLOSED
 * for the first `threshold` failures -> circuit OPEN -> remaining jobs blocked
 * (no gateway call) -> cooldown -> HALF_OPEN probe -> SUCCESS -> CLOSED ->
 * controlled drain. Produces a trace for the demo / assertions.
 */
import {
  type CircuitBreaker,
  type GatewayReliabilityMetrics,
  createCircuitBreaker,
  createInMemoryCircuitStore,
} from '@recovery-desk/circuit-breaker';
import { createSimulator } from '@recovery-desk/simulator';
import { decideDepsFor, executeDepsFor, makeWorld, seedFailure } from './_fakes';
import type { AuditRow } from './_fakes';
import { decideRecovery } from './decide-service';
import { executeRecoveryAction } from './execute-service';

export interface StormTraceRow {
  seq: number;
  atIso: string;
  minute: number;
  paymentId: string;
  recoveryAction: string;
  circuitBefore: string;
  gatewayCall: 'yes' | 'no';
  result: string;
  nextAction: string;
}

export interface StormScenarioResult {
  trace: StormTraceRow[];
  audits: AuditRow[];
  metrics: GatewayReliabilityMetrics;
  gatewayCharges: number;
  finalCircuitState: string;
  recoveredPayments: number;
  simulatorConfig: ReturnType<ReturnType<typeof createSimulator>['describeConfig']>;
}

export interface StormScenarioOptions {
  payments?: number;
  seed?: number;
  originMs?: number;
  stormStartMinute?: number;
  stormDurationMinutes?: number;
  failureThreshold?: number;
  openCooldownSeconds?: number;
}

const MIN = 60_000;

export async function runGatewayStormScenario(
  opts: StormScenarioOptions = {},
): Promise<StormScenarioResult> {
  const payments = opts.payments ?? 20;
  const seed = opts.seed ?? 20260904;
  const originMs = opts.originMs ?? Date.UTC(2026, 8, 4, 10, 0, 0);
  const stormStart = opts.stormStartMinute ?? 60;
  const stormDuration = opts.stormDurationMinutes ?? 10;
  const failureThreshold = opts.failureThreshold ?? 5;
  const openCooldownSeconds = opts.openCooldownSeconds ?? 30;

  let clockMs = originMs;
  const now = () => clockMs;

  const store = createInMemoryCircuitStore({
    failureWindowSeconds: 60,
    probeLockTtlSeconds: 20,
    now,
  });
  const world = makeWorld();
  const pushAudit = (eventType: string, detail: string): void => {
    world.audits.push({
      paymentId: '',
      eventType,
      whatWeSaw: detail,
      whatWeConcluded: 'circuit transition',
      whatWasAllowed: '',
      whatWeDid: eventType,
      whatHappened: '',
      metadata: {},
    });
  };
  const cb: CircuitBreaker = createCircuitBreaker({
    store,
    now,
    config: { failureThreshold, openCooldownSeconds },
    instanceId: 'storm',
    hooks: {
      onOpen: (i) => pushAudit('CIRCUIT_OPENED', i.reason),
      onHalfOpen: (i) => pushAudit('CIRCUIT_HALF_OPEN', i.reason),
      onClose: (i) => pushAudit('CIRCUIT_CLOSED', i.reason),
      onProbeSucceeded: (i) => pushAudit('CIRCUIT_PROBE_SUCCEEDED', i.reason),
      onProbeFailed: (i) => pushAudit('CIRCUIT_PROBE_FAILED', i.reason),
    },
  });

  const gateway = createSimulator({
    seed,
    recoversOnAttempt: 1,
    gatewayStorm: {
      enabled: true,
      originMs,
      startMinute: stormStart,
      durationMinutes: stormDuration,
      failureRate: 1,
      code: '503',
    },
  });
  let charges = 0;
  const realCharge = gateway.charge.bind(gateway);
  gateway.charge = (input) => {
    charges += 1;
    return realCharge(input);
  };

  const actionIds: string[] = [];
  for (let i = 0; i < payments; i += 1) {
    const { failureId } = seedFailure(world, {
      payment: { id: `sim_pay_${i}`, amountMinor: 250_000 + i * 1000, attemptCount: 1 },
      classification: { cause: 'GATEWAY_FAILURE', confidence: 0.9 },
    });
    const d = await decideRecovery(
      failureId,
      decideDepsFor(world, () => new Date(clockMs)),
    );
    if (d.status !== 'DECIDED') throw new Error('scenario setup failed');
    world.actions.get(d.action.id)!.status = 'SCHEDULED';
    actionIds.push(d.action.id);
  }

  const deps = executeDepsFor(world, gateway, () => new Date(clockMs), { circuitBreaker: cb });
  const trace: StormTraceRow[] = [];

  for (let i = 0; i < actionIds.length; i += 1) {
    const actionId = actionIds[i] as string;
    if (i < failureThreshold + 6) {
      clockMs = originMs + stormStart * MIN + i * 4000; // storm window, jobs ~4s apart
    } else if (i === failureThreshold + 6) {
      clockMs = originMs + (stormStart + stormDuration + 5) * MIN; // past storm + past cooldown
    } else {
      clockMs += 3000;
    }

    const action = world.actions.get(actionId)!;
    const before = (await cb.getSnapshot()).state;
    const chargesBefore = charges;
    const res = await executeRecoveryAction(actionId, deps);

    trace.push({
      seq: i + 1,
      atIso: new Date(clockMs).toISOString(),
      minute: Math.round((clockMs - originMs) / MIN),
      paymentId: action.paymentId,
      recoveryAction: action.action,
      circuitBefore: before,
      gatewayCall: charges > chargesBefore ? 'yes' : 'no',
      result: res.status,
      nextAction:
        res.status === 'CIRCUIT_BLOCKED'
          ? `reschedule +${res.retryAfterSeconds}s`
          : res.status === 'EXECUTED_SUCCESS'
            ? 'done (recovered)'
            : res.status,
    });
  }

  const metrics = await cb.getMetrics();
  return {
    trace,
    audits: world.audits,
    metrics,
    gatewayCharges: charges,
    finalCircuitState: (await cb.getSnapshot()).state,
    recoveredPayments: [...world.payments.values()].filter((p) => p.status === 'SUCCEEDED').length,
    simulatorConfig: gateway.describeConfig(),
  };
}
