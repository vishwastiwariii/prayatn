import { createRng } from './rng';
import {
  type AttemptContext,
  type AttemptVerdict,
  type FailureDescriptor,
  evaluateAttempt,
} from './scenarios';
import type { SimulatedDataset } from './dataset';

/**
 * The hidden-state simulator.
 *
 * It privately holds `dataset.truth` and is the ONLY thing that decides whether
 * an attempt succeeds. Callers get `attempt()` and `initialFailure()` — there is
 * no method, field or getter that returns the hidden truth. Same dataset +
 * same call sequence => same verdicts.
 */
export interface HiddenStateSimulator {
  /** The public failure descriptor for the original (already-failed) charge. */
  initialFailure(paymentId: string): FailureDescriptor;
  /** Adjudicate one attempt against the hidden truth. */
  attempt(paymentId: string, ctx: AttemptContext): AttemptVerdict & { latencyMs: number };
  /** Deterministic message-send latency; always "sent" (mock). */
  sendMessageLatencyMs(paymentId: string, n: number): number;
  /** Count of payments in the batch. */
  readonly size: number;
}

export function createHiddenStateSimulator(dataset: SimulatedDataset): HiddenStateSimulator {
  // Closed over — not exposed anywhere on the returned object.
  const truth = dataset.truth;

  const latency = (paymentId: string, tag: string, n: number): number => {
    const r = createRng(`${dataset.seed}:${tag}:${paymentId}:${n}`);
    return 220 + Math.floor(r.next() * 900); // 220..1119 ms
  };

  return {
    size: dataset.payments.length,

    initialFailure(paymentId) {
      const t = truth.get(paymentId);
      if (!t) throw new Error(`unknown payment ${paymentId}`);
      return t.publicFailure;
    },

    attempt(paymentId, ctx) {
      const t = truth.get(paymentId);
      if (!t) throw new Error(`unknown payment ${paymentId}`);
      const verdict = evaluateAttempt(t, ctx);
      return { ...verdict, latencyMs: latency(paymentId, 'charge', ctx.attemptNumber) };
    },

    sendMessageLatencyMs(paymentId, n) {
      return latency(paymentId, 'message', n);
    },
  };
}
