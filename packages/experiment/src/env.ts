import {
  type HiddenStateSimulator,
  type SimulatedPayment,
  createClock,
} from '@recovery-desk/simulator';
import type { PaymentRunResult, RunEnd, StrategyEnv } from './types';

/** Experiment window. A WAIT longer than this is clamped to the window edge. */
export const HORIZON_MINUTES = 21 * 24 * 60;
/** Fixed gap added to gateway latency between attempts (real retry loops sleep). */
const INTER_ATTEMPT_GAP_MS = 2_500;

export type Strategy = (env: StrategyEnv) => void;

/**
 * Run ONE payment through ONE strategy. Creates a private per-payment clock and
 * a `StrategyEnv` that never exposes hidden state. Returns the run result; the
 * strategy sees only what it was handed.
 */
export function runPayment(
  simulator: HiddenStateSimulator,
  payment: SimulatedPayment,
  strategy: Strategy,
): PaymentRunResult {
  const clock = createClock(payment.originatedAtMs);

  let attempts = 1; // the original charge already failed
  let messages = 0;
  let railSwitched = false;
  let recovered = false;
  let amountRecoveredMinor = 0;
  let endedBy: RunEnd | null = null;
  let lastFailure = simulator.initialFailure(payment.id);

  const clampAdvance = (minutes: number): void => {
    const target = Math.min(minutes, HORIZON_MINUTES - clock.minutesSinceStart());
    clock.advance(Math.max(0, target));
  };

  const env: StrategyEnv = {
    payment: {
      id: payment.id,
      method: payment.method,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      salaryDay: payment.salaryDay,
    },
    initialFailure: lastFailure,
    now: () => clock.now(),
    minutesElapsed: () => clock.minutesSinceStart(),
    attemptsMade: () => attempts,
    messagesSent: () => messages,
    railSwitched: () => railSwitched,
    lastFailure: () => lastFailure,

    retry(delayMinutes) {
      clampAdvance(Math.max(0, delayMinutes));
      const attemptNumber = attempts + 1;
      const verdict = simulator.attempt(payment.id, {
        attemptNumber,
        atMs: clock.nowMs(),
        originatedAtMs: payment.originatedAtMs,
        messagesSent: messages,
        railSwitched,
      });
      clock.advance((verdict.latencyMs + INTER_ATTEMPT_GAP_MS) / 60_000);
      attempts = attemptNumber;
      if (verdict.status === 'SUCCESS') {
        recovered = true;
        amountRecoveredMinor = payment.amountMinor;
        endedBy = 'RECOVERED';
        return { status: 'SUCCESS' };
      }
      if (verdict.failure) lastFailure = verdict.failure;
      return { status: 'FAILURE' };
    },

    message() {
      messages += 1;
      clock.advance(simulator.sendMessageLatencyMs(payment.id, messages) / 60_000);
    },

    switchRail() {
      railSwitched = true;
    },

    stop(reason) {
      if (endedBy === null) endedBy = reason;
    },
  };

  strategy(env);

  return {
    paymentId: payment.id,
    method: payment.method,
    amountMinor: payment.amountMinor,
    recovered,
    amountRecoveredMinor,
    attemptsMade: attempts,
    messagesSent: messages,
    railSwitched,
    endedBy: endedBy ?? (recovered ? 'RECOVERED' : 'EXHAUSTED'),
    minutesElapsed: clock.minutesSinceStart(),
  };
}
