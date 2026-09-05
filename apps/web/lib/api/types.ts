/**
 * Domain enums mirrored from `packages/domain/src/enums.ts`. The frontend
 * never redefines their meaning — it only needs the literal unions for typing
 * API responses.
 */
export type PaymentMethod = 'CARD' | 'UPI' | 'NETBANKING' | 'WALLET' | 'MANDATE';

export type PaymentStatus =
  | 'PENDING'
  | 'FAILED'
  | 'RECOVERING'
  | 'SUCCEEDED'
  | 'EXHAUSTED'
  | 'HARD_STOPPED';

export type RecoveryStatus =
  | 'FAILED'
  | 'CLASSIFIED'
  | 'SCHEDULED'
  | 'RETRYING'
  | 'RECOVERED'
  | 'HARD_STOPPED'
  | 'EXHAUSTED'
  | 'HUMAN_REVIEW';

export type RootCause =
  | 'CUSTOMER_FUNDS_LOW'
  | 'CUSTOMER_AUTH_FAILURE'
  | 'CUSTOMER_ABANDONMENT'
  | 'ISSUER_TEMPORARY_FAILURE'
  | 'GATEWAY_FAILURE'
  | 'PAYMENT_METHOD_INVALID'
  | 'MANDATE_INVALID'
  | 'UNKNOWN';

export type RecoveryActionType = 'RETRY' | 'WAIT' | 'SWITCH_RAIL' | 'MESSAGE' | 'HARD_STOP' | 'HUMAN_REVIEW';

export type ClassificationSource = 'RULE' | 'LLM_SUGGESTION' | 'HUMAN';

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  CUSTOMER_FUNDS_LOW: 'Insufficient funds',
  CUSTOMER_AUTH_FAILURE: 'Authentication failed',
  CUSTOMER_ABANDONMENT: 'Abandoned',
  ISSUER_TEMPORARY_FAILURE: 'Issuer temporary',
  GATEWAY_FAILURE: 'Gateway failure',
  PAYMENT_METHOD_INVALID: 'Invalid method',
  MANDATE_INVALID: 'Mandate invalid',
  UNKNOWN: 'Unknown',
};

export const ACTION_LABEL: Record<RecoveryActionType, string> = {
  RETRY: 'Retry',
  WAIT: 'Wait',
  SWITCH_RAIL: 'Switch rail',
  MESSAGE: 'Message',
  HARD_STOP: 'Hard stop',
  HUMAN_REVIEW: 'Human review',
};

export const RECOVERY_STATUS_LABEL: Record<RecoveryStatus, string> = {
  FAILED: 'Failed',
  CLASSIFIED: 'Classified',
  SCHEDULED: 'Scheduled',
  RETRYING: 'Retrying',
  RECOVERED: 'Recovered',
  HARD_STOPPED: 'Hard stopped',
  EXHAUSTED: 'Exhausted',
  HUMAN_REVIEW: 'Human review',
};

/** Fixed categorical hue slot (1-8) per root cause — never reordered. */
export const ROOT_CAUSE_SLOT: Record<RootCause, number> = {
  CUSTOMER_FUNDS_LOW: 1,
  CUSTOMER_AUTH_FAILURE: 2,
  CUSTOMER_ABANDONMENT: 3,
  ISSUER_TEMPORARY_FAILURE: 4,
  GATEWAY_FAILURE: 5,
  PAYMENT_METHOD_INVALID: 6,
  MANDATE_INVALID: 7,
  UNKNOWN: 8,
};

/** Fixed categorical hue slot (1-6) per recovery action — never reordered. */
export const ACTION_SLOT: Record<RecoveryActionType, number> = {
  RETRY: 1,
  WAIT: 2,
  SWITCH_RAIL: 3,
  MESSAGE: 4,
  HARD_STOP: 5,
  HUMAN_REVIEW: 6,
};
