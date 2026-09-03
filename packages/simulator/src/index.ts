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

export interface GatewayChargeInput {
  paymentId: string;
  amountMinor: number;
  method: string;
  /** 1 = original charge, 2 = first retry, ... */
  attemptNumber: number;
}

export interface GatewayChargeResult {
  status: GatewayChargeStatus;
  /** Provider-style code, e.g. `charge_succeeded`, `issuer_declined`. */
  code: string;
  reason: string;
  latencyMs: number;
  /** Minor units actually captured (== amount on success, 0 on failure). */
  amountCapturedMinor: number;
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

export interface Gateway {
  readonly config: SimulatorConfig;
  charge(input: GatewayChargeInput): GatewayChargeResult;
  sendMessage(input: GatewaySendMessageInput): GatewaySendMessageResult;
}

export function createSimulator(partial: Partial<SimulatorConfig> = {}): Gateway {
  const config: SimulatorConfig = { ...DEFAULT_SIMULATOR_CONFIG, ...partial };

  function latency(kind: string, input: { paymentId: string; attemptNumber: number }): number {
    const n = hash32(`${config.seed}:${kind}:${input.paymentId}:${input.attemptNumber}`);
    return 250 + (n % 950); // 250..1199 ms, deterministic
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

    charge(input) {
      const status = decide(input);
      const latencyMs = latency('charge', input);
      if (status === 'SUCCESS') {
        return {
          status,
          code: 'charge_succeeded',
          reason: 'Authorized and captured by the issuer.',
          latencyMs,
          amountCapturedMinor: input.amountMinor,
        };
      }
      const dead = config.deadPaymentIds.includes(input.paymentId);
      return {
        status,
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
