import type { RecoveryActions, RootCause } from '@recovery-desk/domain';

/** Human-readable labels handed to the model so prompts don't leak raw enum tokens. */
export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  CUSTOMER_FUNDS_LOW: 'insufficient funds',
  CUSTOMER_AUTH_FAILURE: 'customer authentication failed',
  CUSTOMER_ABANDONMENT: 'customer abandoned the payment before completing it',
  ISSUER_TEMPORARY_FAILURE: 'temporary issuer/bank failure',
  GATEWAY_FAILURE: 'temporary payment gateway failure',
  PAYMENT_METHOD_INVALID: 'the payment method itself is invalid (e.g. expired card)',
  MANDATE_INVALID: 'the automatic payment mandate has been revoked',
  UNKNOWN: 'unknown / not yet classified',
};

export const RECOVERY_ACTION_LABEL: Record<RecoveryActions, string> = {
  RETRY: 'the system will automatically retry the payment after a short wait',
  WAIT: 'the system will wait before checking again, no customer action needed',
  SWITCH_RAIL: 'the customer is being offered a different way to pay',
  MESSAGE: 'the customer needs to retry the payment themselves',
  HARD_STOP: 'no further automated retries — the customer must use a different payment method',
  HUMAN_REVIEW: 'a person is reviewing this failure',
};
