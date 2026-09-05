/**
 * The breaker's public API returns a `CircuitPermission` rather than throwing,
 * so these are opt-in for callers that prefer exceptions.
 */

export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';
  constructor(readonly retryAfterSeconds: number) {
    super(`Gateway circuit is OPEN; retry after ~${retryAfterSeconds}s`);
  }
}

export class ProbeInProgressError extends Error {
  override readonly name = 'ProbeInProgressError';
  constructor(readonly retryAfterSeconds: number) {
    super('A HALF_OPEN probe is already in progress');
  }
}

/**
 * Marks a gateway result as an infrastructure fault (5xx / timeout), as opposed
 * to a customer payment failure. `code` is the raw provider code.
 */
export class GatewayInfrastructureError extends Error {
  override readonly name = 'GatewayInfrastructureError';
  constructor(
    readonly code: string,
    description: string,
  ) {
    super(`gateway infrastructure failure (${code}): ${description}`);
  }
}
