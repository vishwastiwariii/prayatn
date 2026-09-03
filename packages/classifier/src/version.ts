/**
 * Bump this whenever a rule's behaviour changes (new rule, changed match
 * conditions, changed confidence or precedence). The classification service
 * keys idempotency on `(failureId, classifierVersion)`, so a bump lets a
 * failure be re-classified exactly once by the new logic without deleting the
 * historical row.
 */
export const CLASSIFIER_VERSION = '1.0.0' as const;
