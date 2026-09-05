/**
 * `@recovery-desk/simulator` — the deterministic Mock Gateway.
 *
 * Stands in for a real payment gateway / issuer. It has hidden state (a config)
 * and, given the same config + input, ALWAYS returns the same result: no
 * `Math.random`, no clock reads. This is what the recovery worker charges
 * against, and what every test asserts on.
 *
 * It never touches the database and knows nothing about recovery policy — it
 * only answers "did this charge attempt succeed, and how slowly".
 */

export type GatewayChargeStatus = 'SUCCESS' | 'FAILURE';

/**
 * A gateway 5xx / timeout is NOT a customer payment failure (Phase 10 §3).
 *   SUCCESS         — authorized + captured
 *   PAYMENT_FAILURE — the customer / instrument / mandate failed
 *   GATEWAY_FAILURE — the gateway itself is unhealthy (5xx, timeout)
 */
export type GatewayResultKind = 'SUCCESS' | 'PAYMENT_FAILURE' | 'GATEWAY_FAILURE';

export interface GatewayChargeInput {
  paymentId: string;
  amountMinor: number;
  method: string;
  /** 1 = original charge, 2 = first retry, ... */
  attemptNumber: number;
  /** Wall/sim clock at the moment of the call — used only for the gateway storm. */
  atMs?: number;
  /**
   * Stable per-action key. This simulator ignores it, but a real PSP
   * (Razorpay/Stripe accept an `Idempotency-Key`) would use it to collapse a
   * duplicate charge server-side — the last gap our own atomic claim cannot
   * close (a crash between charging and recording the outcome).
   */
  idempotencyKey?: string;
}

export interface GatewayChargeResult {
  status: GatewayChargeStatus;
  kind: GatewayResultKind;
  /** Provider-style code, e.g. `charge_succeeded`, `issuer_declined`, `503`. */
  code: string;
  reason: string;
  latencyMs: number;
  /** Minor units actually captured (== amount on success, 0 on failure). */
  amountCapturedMinor: number;
}

/**
 * A deterministic gateway outage window (Phase 10 §11). Entirely derived from
 * the config + seed — no uncontrolled randomness.
 */
export interface GatewayStormConfig {
  enabled: boolean;
  /** t = 0 reference (epoch ms). `startMinute` etc. are relative to this. */
  originMs: number;
  startMinute: number;
  durationMinutes: number;
  /** 0..1 — fraction of in-window charges that return a gateway failure. */
  failureRate: number;
  /** Provider code for the storm failures (default `503`). */
  code?: string;
}

export interface GatewaySendMessageInput {
  paymentId: string;
  cause: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
}

export interface GatewaySendMessageResult {
  status: 'SENT';
  messageId: string;
  latencyMs: number;
}

export interface SimulatorConfig {
  /** Deterministic seed folded into latency + default outcomes. */
  seed: number;
  /**
   * Explicit per-payment script. `scripted['pay_1'] = ['FAILURE','SUCCESS']`
   * means attempt 1 fails, attempt 2 (and beyond) succeed.
   */
  scripted: Record<string, GatewayChargeStatus[]>;
  /** These payment ids always fail (`dead_instrument`). */
  deadPaymentIds: string[];
  /**
   * With no script and not dead: the charge succeeds once
   * `attemptNumber >= recoversOnAttempt`. Default 2 → the first retry works,
   * which is the canonical ISSUER_TEMPORARY_FAILURE demo.
   */
  recoversOnAttempt: number;
  /** Force every non-dead, non-scripted charge to fail (e.g. outage demos). */
  forceFailure: boolean;
  /** Deterministic gateway 5xx storm window (Phase 10). */
  gatewayStorm?: GatewayStormConfig;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  seed: 20260828,
  scripted: {},
  deadPaymentIds: [],
  recoversOnAttempt: 2,
  forceFailure: false,
};

/** Small deterministic string hash (FNV-1a, 32-bit). */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface GatewayConfigView {
  seed: number;
  gatewayStorm:
    | (GatewayStormConfig & { startsAtMs: number; endsAtMs: number })
    | null;
}

export interface Gateway {
  readonly config: SimulatorConfig;
  charge(input: GatewayChargeInput): GatewayChargeResult;
  sendMessage(input: GatewaySendMessageInput): GatewaySendMessageResult;
  /** Human/UI-readable view of the config (Phase 10 §12 — no hidden tuning). */
  describeConfig(): GatewayConfigView;
}

export function createSimulator(partial: Partial<SimulatorConfig> = {}): Gateway {
  const config: SimulatorConfig = { ...DEFAULT_SIMULATOR_CONFIG, ...partial };
  const storm = config.gatewayStorm;

  function latency(kind: string, input: { paymentId: string; attemptNumber: number }): number {
    const n = hash32(`${config.seed}:${kind}:${input.paymentId}:${input.attemptNumber}`);
    return 250 + (n % 950); // 250..1199 ms, deterministic
  }

  function inStormWindow(atMs: number | undefined): boolean {
    if (!storm?.enabled || atMs == null) return false;
    const start = storm.originMs + storm.startMinute * 60_000;
    const end = start + storm.durationMinutes * 60_000;
    return atMs >= start && atMs < end;
  }

  function stormHits(input: GatewayChargeInput): boolean {
    if (!inStormWindow(input.atMs)) return false;
    // Deterministic per-(payment, attempt) roll against the configured rate.
    const roll =
      (hash32(`${config.seed}:storm:${input.paymentId}:${input.attemptNumber}`) % 1000) / 1000;
    return roll < (storm?.failureRate ?? 0);
  }

  function decide(input: GatewayChargeInput): GatewayChargeStatus {
    const script = config.scripted[input.paymentId];
    if (script && script.length > 0) {
      const idx = Math.min(input.attemptNumber - 1, script.length - 1);
      return script[Math.max(0, idx)] ?? 'FAILURE';
    }
    if (config.deadPaymentIds.includes(input.paymentId)) return 'FAILURE';
    if (config.forceFailure) return 'FAILURE';
    return input.attemptNumber >= config.recoversOnAttempt ? 'SUCCESS' : 'FAILURE';
  }

  return {
    config,

    describeConfig() {
      if (!storm) return { seed: config.seed, gatewayStorm: null };
      const startsAtMs = storm.originMs + storm.startMinute * 60_000;
      return {
        seed: config.seed,
        gatewayStorm: {
          ...storm,
          startsAtMs,
          endsAtMs: startsAtMs + storm.durationMinutes * 60_000,
        },
      };
    },

    charge(input) {
      const latencyMs = latency('charge', input);

      // Gateway storm wins over everything: the gateway itself is unhealthy.
      if (stormHits(input)) {
        const code = storm?.code ?? '503';
        return {
          status: 'FAILURE',
          kind: 'GATEWAY_FAILURE',
          code,
          reason: `Gateway returned HTTP ${code} (service unavailable).`,
          latencyMs,
          amountCapturedMinor: 0,
        };
      }

      const status = decide(input);
      if (status === 'SUCCESS') {
        return {
          status,
          kind: 'SUCCESS',
          code: 'charge_succeeded',
          reason: 'Authorized and captured by the issuer.',
          latencyMs,
          amountCapturedMinor: input.amountMinor,
        };
      }
      const dead = config.deadPaymentIds.includes(input.paymentId);
      return {
        status,
        kind: 'PAYMENT_FAILURE',
        code: dead ? 'dead_instrument' : 'issuer_declined',
        reason: dead
          ? 'Instrument is permanently unusable.'
          : 'Issuer declined the authorization on this attempt.',
        latencyMs,
        amountCapturedMinor: 0,
      };
    },

    sendMessage(input) {
      const latencyMs = latency('message', { paymentId: input.paymentId, attemptNumber: 1 });
      return {
        status: 'SENT',
        messageId: `msg_${hash32(`${config.seed}:${input.paymentId}:${input.cause}`).toString(16)}`,
        latencyMs,
      };
    },
  };
}

export const SIMULATOR_PACKAGE = '@recovery-desk/simulator' as const;

// --- Phase 8: seeded RNG, sim clock, hidden-state simulator, dataset ---
export { createRng } from './rng';
export type { Rng } from './rng';
export { SIM_EPOCH, MINUTE_MS, createClock, epochPlus } from './clock';
export type { SimClock } from './clock';
export {
  type ScenarioKind,
  type FailureDescriptor,
  type SimulationTruth,
  type AttemptContext,
  type AttemptVerdict,
  buildTruth,
  evaluateAttempt,
} from './scenarios';
export {
  type PaymentMethod as SimPaymentMethod,
  type SimulatedPayment,
  type SimulatedDataset,
  generateDataset,
} from './dataset';
export { type HiddenStateSimulator, createHiddenStateSimulator } from './simulator';
