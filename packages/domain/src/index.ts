/**
 * Recovery Desk domain model.
 * Phase 2 introduces the real types (PaymentMethod, FailureSource, RootCause,
 * RecoveryStatus, ...). Nothing here yet.
 */
export const DOMAIN_PACKAGE = '@recovery-desk/domain' as const;


export const RECOVERY_LIMITS = {
  MAX_ATTEMPTS: 3,
  MAX_MESSAGES_PER_DAY: 2,
  QUIET_HOURS_START: 22,
  QUIET_HOURS_END: 8,
} as const;

export * from './enums'

export * from './models'