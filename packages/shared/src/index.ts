/**
 * Shared constants and cross-service contracts for Recovery Desk.
 * Intentionally tiny for Phase 1 — no business logic yet.
 */

export const SERVICE_NAME = 'recovery-desk' as const;

export type DependencyStatus = 'ok' | 'error';

/** Shape returned by the API's `GET /health` endpoint. */
export interface HealthResponse {
  status: 'ok';
  service: typeof SERVICE_NAME;
}

/** Shape returned by the API's `GET /health/dependencies` endpoint. */
export interface DependencyHealthResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
  };
}
